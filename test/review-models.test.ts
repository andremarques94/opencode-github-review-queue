import { describe, expect, it } from "vitest"
import { rememberModel, reviewModels } from "../src/server/review/models.js"

const model = (providerID: string, id: string, enabled = true) => ({ providerID, id, name: id.toUpperCase(), enabled })

function context(saved?: unknown) {
  const storage = new Map<string, unknown>(saved ? [["review-model", saved]] : [])
  return {
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => void storage.set(key, value),
    },
    model: {
      list: async () => ({ data: [model("anthropic", "opus"), model("go", "flash"), model("go", "off", false)] }),
      default: async () => ({ data: model("go", "flash") }),
    },
    provider: { list: async () => ({ data: [{ id: "anthropic", name: "Anthropic" }] }) },
  } as never
}

describe("reviewModels", () => {
  it("lists enabled models with provider names and preselects the default", async () => {
    expect(await reviewModels(context())).toEqual({
      models: [
        { providerID: "anthropic", id: "opus", name: "OPUS", provider: "Anthropic" },
        { providerID: "go", id: "flash", name: "FLASH", provider: "go" },
      ],
      preferred: { providerID: "go", id: "flash" },
    })
  })

  it("prefers the last pick while it is still available", async () => {
    const ctx = context()
    await rememberModel((ctx as { storage: never }).storage, { providerID: "anthropic", id: "opus" })
    expect((await reviewModels(ctx)).preferred).toEqual({ providerID: "anthropic", id: "opus" })

    expect((await reviewModels(context({ providerID: "go", id: "off" }))).preferred).toEqual({
      providerID: "go",
      id: "flash",
    })
  })
})
