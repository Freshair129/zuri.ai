import base from '../../../vitest.config.js'

export default {
  ...base,
  test: {
    ...base.test,
    include: [
      'tests/fixtures/file-database-isolation/probe-a.test.js',
      'tests/fixtures/file-database-isolation/probe-b.test.js',
    ],
    fileParallelism: false,
  },
}
