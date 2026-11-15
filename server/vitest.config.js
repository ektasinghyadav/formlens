// Test settings for the server.
// All server tests share ONE real MySQL database, so test files run one after another.
// (Run in parallel, their cleanup DELETEs could deadlock each other.)
export default {
  test: {
    fileParallelism: false,
    testTimeout: 20000,
  },
};
