import { Rpc } from "@opencode/plugin/rpc"

const object = { type: "object", additionalProperties: true } as const
const empty = { type: "object", additionalProperties: false } as const

export const ReviewQueue = Rpc.define({
  id: "github-review-queue",
  methods: {
    snapshot: { input: empty, output: object },
    refresh: { input: empty, output: object },
    repository: {
      input: {
        type: "object",
        properties: { directory: { type: "string" } },
        required: ["directory"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { repository: { type: ["string", "null"] } },
        required: ["repository"],
        additionalProperties: false,
      },
    },
    open: {
      input: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { opened: { type: "boolean" } },
        required: ["opened"],
        additionalProperties: false,
      },
    },
  },
  events: {
    state: { schema: object },
    discovered: { schema: object },
  },
} satisfies Rpc.PortableDefinition)
