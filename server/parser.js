/**
 * CardVoice Number Parser
 * Ported from backend/voice/engine.py — same logic, same output.
 */

// Word-to-number mapping (covers speech recognition quirks)
const WORD_TO_NUM = {
  // Basic digits
  zero: 0, one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  // Common misheard
  won: 1, wan: 1, wun: 1,
  to: 2, too: 2, tu: 2, tew: 2,
  tree: 3, free: 3,
  for: 4, fore: 4, fo: 4,
  fife: 5,
  sick: 6, sicks: 6,
  ate: 8,
  nein: 9,
  // Teens
  ten: 10, tin: 10,
  eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
  // Tens
  twenty: 20, thirty: 30, forty: 40, fourty: 40,
  fifty: 50, fitty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // Hundred as standalone
  hundred: 100,
};

// Multiplier words
const MULT_WORDS = new Set([
  'times', 'x', 'of', 'count', 'quantity', 'qty', 'stock', 'copies', 'copy', 'ex',
]);

// Skip words
const SKIP_WORDS = new Set([
  'and', 'the', 'a', 'an', 'um', 'uh', 'like', 'okay', 'ok',
  'card', 'number', 'hash', 'pound', 'next', 'then', 'also',
  'have', 'got', 'need', 'want', 'is', 'are', 'it', 'that',
  'this', 'so', 'yeah', 'yes', 'no', 'not', 'with', 'from',
]);


/**
 * Parse a single token as a number.
 * @returns {number|null}
 */
function _parseSingleNumber(token) {
  if (token in WORD_TO_NUM) return WORD_TO_NUM[token];
  const n = parseInt(token, 10);
  return isNaN(n) ? null : n;
}


/**
 * Parse a compound spoken number starting at position `start`.
 * Handles: "one hundred twenty three", "fifty five", "three", "42", etc.
 * @returns {{ number: number|null, consumed: number }}
 */
function _parseCompoundNumber(tokens, start) {
  if (start >= tokens.length) return { number: null, consumed: 0 };

  const token = tokens[start];

  // Check if it's a digit string
  if (/^\d+$/.test(token)) return { number: parseInt(token, 10), consumed: 1 };

  // Check for word number
  if (!(token in WORD_TO_NUM)) return { number: null, consumed: 0 };

  let value = WORD_TO_NUM[token];
  let consumed = 1;

  // "three hundred forty two" pattern
  if (value >= 1 && value <= 9 && start + 1 < tokens.length && tokens[start + 1] === 'hundred') {
    value *= 100;
    consumed = 2;

    // Skip "and" if present
    if (start + consumed < tokens.length && tokens[start + consumed] === 'and') {
      consumed++;
    }
    if (start + consumed < tokens.length) {
      const nextVal = _parseSingleNumber(tokens[start + consumed]);
      if (nextVal !== null) {
        if (nextVal >= 1 && nextVal <= 19) {
          value += nextVal;
          consumed++;
        } else if (nextVal >= 20 && nextVal <= 90) {
          value += nextVal;
          consumed++;
          // Check for ones after tens: "hundred twenty THREE"
          if (start + consumed < tokens.length) {
            const onesVal = _parseSingleNumber(tokens[start + consumed]);
            if (onesVal !== null && onesVal >= 1 && onesVal <= 9) {
              value += onesVal;
              consumed++;
            }
          }
        }
      }
    }
    return { number: value, consumed };
  }

  // Compound tens: "twenty three"
  if (value >= 20 && value <= 90) {
    if (start + 1 < tokens.length) {
      const nextVal = _parseSingleNumber(tokens[start + 1]);
      if (nextVal !== null && nextVal >= 1 && nextVal <= 9) {
        value += nextVal;
        consumed = 2;
      }
    }
    return { number: value, consumed };
  }

  // Simple single number
  return { number: value, consumed };
}


/**
 * Parse spoken text into a list of card numbers.
 * Handles digits, spoken words, multipliers, mixed input.
 * @param {string} text
 * @returns {number[]}
 */
function parseSpokenNumbers(text) {
  if (!text) return [];

  // Clean input
  text = text.toLowerCase().trim();
  text = text.replace(/[-\u2013\u2014]/g, ' ');   // Remove dashes
  text = text.replace(/[,.!?;:]/g, ' ');           // Remove punctuation
  text = text.replace(/\s+/g, ' ');                // Normalize whitespace

  const tokens = text.split(' ').filter(Boolean);
  const results = [];
  let i = 0;
  let lastNumber = null;

  while (i < tokens.length) {
    const token = tokens[i];

    // Skip filler words
    if (SKIP_WORDS.has(token)) { i++; continue; }

    // Handle multiplier: "times N", "x N", "count N"
    if (MULT_WORDS.has(token) && lastNumber !== null) {
      if (i + 1 < tokens.length) {
        const mult = _parseSingleNumber(tokens[i + 1]);
        if (mult !== null && mult >= 1 && mult <= 50) {
          for (let j = 0; j < mult - 1; j++) results.push(lastNumber);
          i += 2;
          continue;
        }
      }
      i++;
      continue;
    }

    // Try compound number
    const { number, consumed } = _parseCompoundNumber(tokens, i);

    if (number !== null && number >= 1 && number <= 9999) {
      results.push(number);
      lastNumber = number;
      i += consumed;
    } else {
      // Try raw digits in the token
      const digits = token.match(/\d+/g);
      if (digits) {
        for (const d of digits) {
          const v = parseInt(d, 10);
          if (v >= 1 && v <= 9999) {
            results.push(v);
            lastNumber = v;
          }
        }
      }
      i++;
    }
  }

  return results;
}


/**
 * Parse text for explicit "card <id> Q <qty>" pairs.
 * @param {string} text
 * @returns {Array<{card: number, qty: number, confidence: number}>}
 */
function parseCardQuantities(text) {
  if (!text) return [];

  const QTY_TOKENS = new Set(['q', 'que', 'cue', 'qty', 'quantity', 'count', 'x', 'times']);

  let s = text.toLowerCase();
  s = s.replace(/[,.!?;:]/g, ' ');
  s = s.replace(/[-\u2013\u2014]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // Split on "card" keyword
  const parts = s.split(/\bcard\b/).map(p => p.trim()).filter(Boolean);
  const pairs = [];

  for (const part of parts) {
    const tokens = part.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;

    let cardId = null;
    let qty = null;
    let confidence = 0.0;
    let explicitQtyToken = false;

    // Find card id
    let i = 0;
    let tokenRemainder = null;

    while (i < tokens.length) {
      const token = tokens[i];
      const { number: num, consumed } = _parseCompoundNumber(tokens, i);
      if (num !== null) {
        cardId = num;
        i += consumed;
        break;
      }
      // Try raw digits
      const m = token.match(/^(\d+)$/);
      if (m) {
        cardId = parseInt(m[1], 10);
        i++;
        break;
      }
      // Try leading digits (e.g., "27q9")
      const mLead = token.match(/^(\d+)(.+)$/);
      if (mLead) {
        cardId = parseInt(mLead[1], 10);
        tokenRemainder = mLead[2];
        i++;
        break;
      }
      i++;
    }

    if (cardId === null) continue;

    // Check remainder of previous token for qty (e.g., "q9" from "27q9")
    let qtyFoundInToken = false;
    if (tokenRemainder) {
      for (const kw of QTY_TOKENS) {
        if (tokenRemainder.startsWith(kw)) {
          const qtyRemainder = tokenRemainder.slice(kw.length);
          explicitQtyToken = true;
          const rm = qtyRemainder.match(/^(\d+)/);
          if (rm) {
            qty = parseInt(rm[1], 10);
            qtyFoundInToken = true;
          }
          break;
        }
      }
    }

    // Search further tokens for qty
    if (!qtyFoundInToken) {
      while (i < tokens.length) {
        const token = tokens[i];

        if (SKIP_WORDS.has(token)) { i++; continue; }

        // Check if token starts with a qty keyword
        let qtyKeyword = null;
        let qtyRemainder = null;
        for (const kw of QTY_TOKENS) {
          if (token.startsWith(kw)) {
            qtyKeyword = kw;
            qtyRemainder = token.slice(kw.length);
            break;
          }
        }

        if (qtyKeyword) {
          explicitQtyToken = true;
          if (qtyRemainder && /^\d+/.test(qtyRemainder)) {
            const rm = qtyRemainder.match(/^(\d+)/);
            if (rm) {
              qty = parseInt(rm[1], 10);
              i++;
              break;
            }
          } else if (i + 1 < tokens.length) {
            const { number: num, consumed } = _parseCompoundNumber(tokens, i + 1);
            if (num !== null) {
              qty = num;
              i += 1 + consumed;
              break;
            }
            const dm = tokens[i + 1].match(/^(\d+)/);
            if (dm) {
              qty = parseInt(dm[1], 10);
              i += 2;
              break;
            }
          }
          i++;
          continue;
        }

        // Check for number followed by qty token (e.g., "9q" or "20qty")
        const mLead = token.match(/^(\d+)([a-z]+)/);
        if (mLead) {
          const leadingNum = parseInt(mLead[1], 10);
          const trailingLetters = mLead[2];
          if (QTY_TOKENS.has(trailingLetters)) {
            qty = leadingNum;
            confidence = 0.70;
            i++;
            break;
          }
        }

        // Positional qty (lower confidence)
        const { number: num, consumed } = _parseCompoundNumber(tokens, i);
        if (num !== null) {
          qty = num;
          i += consumed;
          break;
        }
        const posM = token.match(/^(\d+)$/);
        if (posM) {
          qty = parseInt(posM[1], 10);
          i++;
          break;
        }
        i++;
      }
    }

    // Compute confidence and defaults
    if (cardId !== null) {
      if (qty === null) {
        qty = 1;
        confidence = 0.85;
      } else if (explicitQtyToken) {
        confidence = 0.98;
      } else if (confidence === 0) {
        confidence = 0.70;
      }

      if (qty < 0) qty = Math.abs(qty);
      if (qty === 0) confidence = Math.min(confidence, 0.5);

      pairs.push({ card: cardId, qty, confidence });
    }
  }

  return pairs;
}


/**
 * Count occurrences of each card number.
 * @param {number[]} numbers
 * @returns {Object<number, number>}
 */
function countCards(numbers) {
  const counts = {};
  for (const n of numbers) {
    counts[n] = (counts[n] || 0) + 1;
  }
  return counts;
}


/**
 * Format parsed numbers into the "Have:" output string.
 * @param {number[]} numbers
 * @returns {string}
 */
function formatOutput(numbers) {
  const counts = countCards(numbers);
  const sorted = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const parts = sorted.map(n =>
    counts[n] > 1 ? `${n} x${counts[n]}` : `${n}`
  );
  return 'Have: ' + parts.join(', ');
}


module.exports = {
  parseSpokenNumbers,
  parseCardQuantities,
  countCards,
  formatOutput,
  // Expose internals for testing
  _parseSingleNumber,
  _parseCompoundNumber,
  WORD_TO_NUM,
  MULT_WORDS,
  SKIP_WORDS,
};
