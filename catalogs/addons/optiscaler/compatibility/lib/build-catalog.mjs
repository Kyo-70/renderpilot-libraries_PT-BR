import { validateCompatibilityAuthoring } from "./validate-authoring.mjs";

/** Builds the two public, intentionally title-free compatibility documents. */
export function buildCompatibilityCatalog(inputs) {
  const { snapshot, curatedGames, messages } = inputs;
  const { entries, messageIndex } = validateCompatibilityAuthoring(inputs);
  const orderedEntries = [...entries].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const catalog = {
    schema_version: 1,
    revision: curatedGames.revision,
    upstream: {
      source: snapshot.source,
      snapshot_revision: snapshot.snapshot_revision,
      snapshot_sha256: snapshot.snapshot_sha256,
    },
    entries: orderedEntries.map((entry) => ({
      id: entry.id,
      status: entry.status,
      identities: entry.identities,
      declared_inputs: entry.declared_inputs,
      guidance: entry.guidance.map((guidance) => ({
        kind: guidance.kind,
        message: {
          id: guidance.message_id,
          fallback_text: messageIndex.get(guidance.message_id).fallback_text,
        },
      })),
      variants: entry.variants,
    })),
  };
  const messageContract = {
    schema_version: 1,
    revision: curatedGames.revision,
    messages: [...messageIndex.values()]
      .map((message) => ({
        id: message.id,
        fallback_text: message.fallback_text,
        guidance_kind: message.guidance_kind,
        context: message.context,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  return {
    catalog,
    messageContract,
    stats: { entries: catalog.entries.length, messages: messageContract.messages.length },
  };
}
