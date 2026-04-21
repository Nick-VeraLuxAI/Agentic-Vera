const memoryStore = require("./memoryStore");

module.exports = {
  getFacts: memoryStore.getFacts,
  addFact: memoryStore.addFact,
  deleteFact: memoryStore.deleteFact,
  clearFacts: memoryStore.clearFacts,
};
