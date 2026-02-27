// state_manager.js (Final Version with Conversation Timeout)

const userStates = {};

// The timeout limit in milliseconds.
// 30 minutes * 60 seconds/minute * 1000 milliseconds/second = 1,800,000
const CONVERSATION_TIMEOUT = 30 * 60 * 1000;

/**
 * Sets the current state for a user and adds a timestamp.
 * This state will automatically expire after the CONVERSATION_TIMEOUT period.
 * @param {string} userId - The unique ID of the user.
 * @param {string} state - The name of the state (e.g., 'awaiting_email').
 * @param {object} data - Any data to store with the state (e.g., { modId: 1 }).
 */
const setUserState = (userId, state, data = {}) => {
  userStates[userId] = {
    state,
    ...data,
    timestamp: Date.now() // Add the current time to the state
  };
};

/**
 * Retrieves the current state for a user, but only if it has not expired.
 * If the state is older than the timeout, it is automatically deleted.
 * @param {string} userId - The unique ID of the user.
 * @returns {object | null} The user's state object, or null if none exists or it has expired.
 */
const getUserState = (userId) => {
  const userState = userStates[userId];

  // If there's no state at all, return null.
  if (!userState) {
    return null;
  }

  const timeElapsed = Date.now() - userState.timestamp;

  // Check if the state has expired.
  if (timeElapsed > CONVERSATION_TIMEOUT) {
    // The state is too old, so clear it and return null as if it never existed.
    delete userStates[userId];
    return null;
  }

  // The state is valid and not expired, so return it.
  return userState;
};

/**
 * Manually clears the state for a user, typically after a conversation flow is complete.
 * @param {string} userId - The unique ID of the user.
 */
const clearUserState = (userId) => {
  delete userStates[userId];
};

module.exports = {
  setUserState,
  getUserState,
  clearUserState,
};
