import type { Plugin } from "@opencode/plugin"
import * as v from "valibot"
import { ModelRef } from "../../shared/rpc.js"

const PREFERRED_KEY = "review-model"

export async function reviewModels(ctx: Pick<Plugin.Context, "model" | "provider" | "storage">) {
  const [models, providers, fallback, saved] = await Promise.all([
    ctx.model.list({ types: ["chat"] }),
    ctx.provider.list(),
    ctx.model.default(),
    ctx.storage.get(PREFERRED_KEY),
  ])
  const providerNames = new Map(providers.data.map((provider) => [provider.id as string, provider.name]))
  const choices = models.data
    .filter((model) => model.enabled)
    .map((model) => ({
      providerID: model.providerID as string,
      id: model.id as string,
      name: model.name,
      provider: providerNames.get(model.providerID) ?? model.providerID,
    }))
  const available = (ref: ModelRef | undefined) =>
    ref && choices.some((choice) => choice.providerID === ref.providerID && choice.id === ref.id) ? ref : undefined
  const last = v.safeParse(ModelRef, saved)
  const preferred =
    available(last.success ? last.output : undefined) ??
    available(fallback.data ? { providerID: fallback.data.providerID, id: fallback.data.id } : undefined)
  return { models: choices, preferred: preferred ?? null }
}

export const rememberModel = (storage: Plugin.Context["storage"], model: ModelRef) => storage.set(PREFERRED_KEY, model)
