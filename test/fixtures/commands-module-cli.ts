/**
 * Fixture CLI for the experimental `createCli({module: ...})` feature, using the `URL` module form. The URL
 * resolves relative to *this file*, not `process.cwd()` - the e2e test runs it from an unrelated directory to
 * prove distributed CLIs (e.g. globally-installed binaries) work regardless of where they're invoked.
 */
import {createCli} from '../../src/index.js'

void createCli({module: new URL('commands-module.ts', import.meta.url), name: 'mypkg'}).run()
