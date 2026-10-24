import { readFileSync } from "node:fs";
import { digestBytes } from "../../packages/ltp-engine/src/canonical";
import type {
  AcquisitionConfig,
  ApwTxtManifest,
  ComposedResult,
  LtpHandoff,
  LtpLimits,
  PrefixState,
  TrustPolicy,
} from "../../packages/ltp-engine/src/types";
import type { LtpTransport, TransportRequest, TransportResponse } from "../../packages/ltp-engine/src/transport";

const ROOT = new URL("../../docs/protocol-apw/vectors/ltp/v0.3/", import.meta.url);
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));

interface MaterialRecord {
  codec: "jcs" | "utf8-txt" | "ascii-jws";
  wireHex: string;
  byteLength: number;
  soloPruebas: true;
}

export interface V03Fixture {
  id: string;
  variant: string;
  configByteRef: string;
  policyByteRef: string;
  clock: {
    acquisitionWallSeconds: number;
    verificationEntryWallSeconds: number;
    verificationFinalWallSeconds: number;
    operationStartMonotonicMs: number;
    deadlineMonotonicMs: number;
  };
  A: {
    transcripts: Array<{
      id: string;
      request: { method: "GET" | "POST"; url: string; headers: Record<string, string>; bodyByteRef?: string };
      response: { status: number; tlsAuthenticated: boolean; bodyByteRef: string; resolverId?: string };
    }>;
    producerHandoffByteRef: string;
    literalSelectedTtlExpiry: number;
    handoffDelivered: boolean;
  };
  B: {
    consumerHandoffByteRef: string | null;
    initialStateByteRef: string;
    declaredSlices: Array<{ id: string; inputStateByteRef: string; outputStateByteRef: string }>;
    literalFinalOutputByteRef: string;
  };
  resourceFacts: {
    acquisitionElapsedMs: number[];
    acquisitionAdmittedElapsedMs: number[];
    verificationTimeline: Array<{ boundary: string; elapsedMs: number }>;
  };
  expected: ComposedResult;
}

export interface FixtureBank {
  fixture: V03Fixture;
  materials: Record<string, MaterialRecord>;
  refBytes(ref: string): Uint8Array;
  refJson<T = unknown>(ref: string): T;
  config(): AcquisitionConfig;
  policy(): TrustPolicy;
  limits(): LtpLimits;
  rootManifest(): ApwTxtManifest;
  request(): Record<string, unknown>;
  handoff(): LtpHandoff;
  initialState(): PrefixState;
  slices(): Array<{ id: string; input: PrefixState; output: PrefixState }>;
  subject(): string;
  requestId(): string;
  verificationWall(elapsedMs: number): number;
}

export function loadCase(id: string): FixtureBank {
  const fileName = `${id.toLowerCase()}.json`;
  const fixture = readJson(fileName) as V03Fixture;
  const materials = readJson("materials.json").materials as Record<string, MaterialRecord>;
  const refBytes = (ref: string): Uint8Array => {
    const record = materials[ref];
    if (!record) throw new Error(`missing material ${ref}`);
    return Uint8Array.from(Buffer.from(record.wireHex, "hex"));
  };
  const refJson = <T = unknown>(ref: string): T => JSON.parse(Buffer.from(refBytes(ref)).toString("utf8")) as T;
  const handoffPlain = refJson<Record<string, unknown>>(fixture.A.producerHandoffByteRef);
  const packageBytes = handoffPlain.packageByteRef ? refBytes(handoffPlain.packageByteRef as string) : new Uint8Array();
  const handoff = { ...handoffPlain, packageBytes } as unknown as LtpHandoff;
  const config = refJson<AcquisitionConfig>(fixture.configByteRef);
  const policy = refJson<TrustPolicy>(fixture.policyByteRef);
  const request = refJson<Record<string, unknown>>(fixture.A.transcripts[1].request.bodyByteRef!);
  const initialState = refJson<PrefixState>(fixture.B.initialStateByteRef);
  const slices = fixture.B.declaredSlices.map(slice => ({
    id: slice.id,
    input: refJson<PrefixState>(slice.inputStateByteRef),
    output: refJson<PrefixState>(slice.outputStateByteRef),
  }));
  return {
    fixture, materials, refBytes, refJson,
    config: () => config,
    policy: () => policy,
    limits: () => config.limits,
    rootManifest: () => handoff.root.manifest,
    handoff: () => handoff,
    initialState: () => initialState,
    slices: () => slices,
    subject: () => handoff.subject,
    requestId: () => String(request.requestId),
    verificationWall: (elapsedMs) => handoff.root.receivedAt + Math.floor(elapsedMs / 1000),
  };
}

export class FakeClock {
  constructor(public ms = 0) {}
  now = () => this.ms;
  advance(ms: number): void {
    this.ms += ms;
  }
}

/**
 * Replays only the recorded fixture bytes. It asserts the engine constructed the
 * exact request, so an unexpected URL, body, header or extra hop fails the test.
 */
export class ReplayTransport implements LtpTransport {
  readonly channel = "consumer-https-fixture";
  readonly calls: TransportRequest[] = [];

  constructor(
    private readonly bank: FixtureBank,
    private readonly clock: FakeClock,
  ) {}

  async send(request: TransportRequest): Promise<TransportResponse> {
    const callIndex = this.calls.length;
    this.calls.push(request);
    const transcript = request.stage === "A-DOH" ? this.bank.fixture.A.transcripts[0] : this.bank.fixture.A.transcripts[1];
    if (request.method !== transcript.request.method) throw new Error(`unexpected method at hop ${callIndex}`);
    if (request.url !== transcript.request.url) throw new Error(`unexpected URL at hop ${callIndex}: ${request.url}`);
    if (JSON.stringify(request.headers) !== JSON.stringify(transcript.request.headers)) {
      throw new Error(`unexpected headers at hop ${callIndex}`);
    }
    if (transcript.request.bodyByteRef) {
      if (!request.body) throw new Error("expected a request body");
      if (digestBytes(request.body) !== digestBytes(this.bank.refBytes(transcript.request.bodyByteRef))) {
        throw new Error("request body differs from the frozen fixture bytes");
      }
    } else if (request.body) {
      throw new Error("unexpected request body");
    }
    const elapsed = this.bank.fixture.resourceFacts.acquisitionAdmittedElapsedMs[callIndex];
    if (!Number.isSafeInteger(elapsed)) throw new Error(`unexpected hop ${callIndex}`);
    this.clock.advance(elapsed);
    return {
      status: transcript.response.status,
      tlsAuthenticated: transcript.response.tlsAuthenticated,
      body: this.bank.refBytes(transcript.response.bodyByteRef),
      resolverId: transcript.response.resolverId,
      channel: this.channel,
    };
  }
}

export function scriptedClock(values: number[]): () => number {
  let index = 0;
  let last = 0;
  return () => {
    if (index < values.length) last = values[index++];
    return last;
  };
}
