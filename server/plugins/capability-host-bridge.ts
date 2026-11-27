// server/plugins/capability-host-bridge.ts
// Composicion L5 del CapabilityHostBridge de Portaless: conecta los puertos
// puros de @portaless/plugin-sandbox con los stores concretos de contenido,
// settings y actividad del nodo.

import {
  createCapabilityHostBridge,
  type CapabilityBackendEnv,
} from "@portaless/plugin-sandbox/capability-backends";
import type { CapabilityHostBridge } from "@portaless/plugin-sandbox/types";
import { createPageStore } from "@portaless/visual-elements/store-factory";
import { isPubliclyPublishable } from "@portaless/visual-elements/draft-filter";
import { createSiteSettingsStore } from "@portaless/dashboard/site-settings";
import { emitActivity } from "@portaless/dashboard/activity";

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
