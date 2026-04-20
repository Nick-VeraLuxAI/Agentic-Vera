// memory/salienceScorer.js

function scoreFact(fact, history = []) {
    let score = 0;
  
    const lowerFact = fact.toLowerCase();
  
    // 🎯 Rule 1: Direct instruction boost
    if (/remember|please remember/i.test(fact)) score += 3;
  
    // 🎯 Rule 2: Emotional intensity keywords
    if (/\b(really|absolutely|always|never|love|hate)\b/i.test(fact)) score += 2;
  
    // 🎯 Rule 3: Frequency in recent history
    const mentions = history.filter(msg =>
      msg.role === "user" && msg.content.toLowerCase().includes(lowerFact)
    ).length;
    score += Math.min(mentions, 3); // max +3 boost
  
    return score;
  }
  
  function shouldPersistFact(fact, history = [], threshold = 4) {
    const score = scoreFact(fact, history);
    return { score, shouldSave: score >= threshold };
  }
  
  module.exports = { shouldPersistFact };
  