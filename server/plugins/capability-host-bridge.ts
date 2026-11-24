// server/plugins/capability-host-bridge.ts
// Composicion L5 del CapabilityHostBridge de Portaless: conecta los puertos
// puros de @portaless/plugin-sandbox con los stores concretos de contenido,
// settings y actividad del nodo.

import {
  createCapabilityHostBridge,
  type CapabilityBackendEnv,
} from "../../packages/plugin-sandbox/src/capabilities/capability-backends";
import type { CapabilityHostBridge } from "../../packages/plugin-sandbox/src/types";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { isPubliclyPublishable } from "../../packages/atomic-elements/src/persistence/draft-filter";
import { createSiteSettingsStore } from "../../packages/dashboard/src/site-settings/site-settings-store";
import { emitActivity } from "../../packages/dashboard/src/activity/activity-store";

export function createPortalessCapabilityHostBridge(
  env: CapabilityBackendEnv = {}
): CapabilityHostBridge {
  return createCapabilityHostBridge(env, {
    createPageStore: createPageStore as never,
    isPubliclyPublishable,
    createSiteSettingsStore,
    emitActivity: emitActivity as never,
  });
}
