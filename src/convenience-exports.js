/* eslint-disable @rushstack/packlets/circular-deps */
/* eslint-disable @rushstack/packlets/mechanics */
try {
  const zod = require('zod/v4')
  module.exports.z = zod.z
  module.exports.zod = zod
} catch {
  // meh
}

try {
  const trpcServer = require('@trpc/server')
  module.exports.trpcServer = trpcServer
} catch {
  // meh
}
