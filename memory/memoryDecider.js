// memory/memoryDecider.js

function shouldRemember(userInput) {
  const text = userInput.trim();

  const memoryTriggers = [
    /\bremember( that)?\b/i,
    /\bplease remember\b/i,
    /\bi always\b/i,
    /\bi never\b/i,
    /\bi like\b/i,
    /\bi don’t like\b/i,
    /\bmy favorite\b/i,
    /\bi prefer\b/i,
    /\bi usually\b/i,
    /\byou should\b/i,
    /\byou need to\b/i,
    /\bfor the future,\s*i\b/i,
    /\bin general,\s*i\b/i,
  ];

  for (const pattern of memoryTriggers) {
    if (pattern.test(text)) {
      return {
        shouldSave: true,
        fact: userInput.trim() // ✅ Preserve the full user input — no stripping
      };
    }
  }

  return { shouldSave: false };
}

  
function shouldForget(userInput) {
  const text = userInput.trim().toLowerCase();

  const forgetTriggers = [
    /^forget (that )?/,
    /^please forget/,
    /^don’t remember\b/,
    /^remove the fact\b/,
    /^i no longer\b/,
  ];

  const negativePreferenceTriggers = /\b(i\s+don['’]t like|i\s+dislike|i\s+hate|i\s+can'?t stand|i\s+do not like)\b/;

  for (const pattern of forgetTriggers) {
    if (pattern.test(text)) {
      const cleaned = userInput.replace(/^(please )?forget (that )?/i, "").trim();
      return {
        shouldDelete: true,
        fact: cleaned,
      };
    }
  }

  if (negativePreferenceTriggers.test(text)) {
    return {
      shouldDelete: true,
      fact: userInput.trim(), // Pass full input like "I don't like grapes"
    };
  }

  return { shouldDelete: false };
}

  
  module.exports = { shouldRemember, shouldForget };
  