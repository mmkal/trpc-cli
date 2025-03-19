// some of the tests snapshot `--help` output, which does "smart" line wrapping based on the width of the terminal.
// this varies between CI and local machines, so set isTTY to false so commander does its (consistent) default wrapping behaviour.
// https://github.com/tj/commander.js/blob/e6f56c888c96d1339c2b974fee7e6ba4f2e3d218/lib/command.js#L66

// note: if this breaks some day, we could hook into the `Command` class and use `configureOutput` but easier to do globally for now.

for (const stream of [process.stdout, process.stderr]) {
  stream.columns = Infinity // ridiculous value to make sure I notice if the below line is removed
  stream.isTTY = false // set to false to simulate CI behaviour and avoid snapshot failures
}
