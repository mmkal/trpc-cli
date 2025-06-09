import {trpcServer, TrpcCliMeta, createCli, z} from "trpc-cli"
const t = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const router = t.router({
  sayHello: t.procedure
    .input(
      z.tuple([
        z.string().describe("name"),
        z.object({
          enthusiasm: z.number().describe("exclamation marks"),
        })
      ])
    )
    .query(({input}) => {
      const [name, {enthusiasm}] = input
      return `Hello ${name}` + !.repeat(enthusiasm)
    })
})

const cli = createCli({router})

void cli.run()