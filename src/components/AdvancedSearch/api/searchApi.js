/**
 * searchApi.js
 * ─────────────────────────────────────────────────────────────
 * Server-side API definitions for AdvancedSearch modules.
 *
 * Each module API is an async function with signature:
 *   (parsedQuery, options) => Promise<Array>
 *
 * Where:
 *   - parsedQuery: { keywords, phrase, filters, isEmpty }
 *   - options: { signal } (AbortSignal for cancellation)
 *
 * The function should return an array of items matching the query.
 */

// ─────────────────────────────────────────────────────────────
// API BASE CONFIGURATION
// ─────────────────────────────────────────────────────────────

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const API_TIMEOUT = 5000; // 5 seconds


async function apiFetch(url, options = {}) {
  const { signal, method = 'GET', body, headers = {} } = options;

  const config = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    signal,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('[API] Request aborted:', url);
      throw error;
    }
    console.error('[API] Fetch error:', error);
    throw error;
  }
}

/**
 * Build query parameters from parsedQuery
 */
function buildQueryParams(parsedQuery) {
  const params = new URLSearchParams();

  // Add search terms
  if (parsedQuery.keywords?.length > 0) {
    params.append('q', parsedQuery.keywords.join(' '));
  }

  if (parsedQuery.phrase) {
    params.append('phrase', parsedQuery.phrase);
  }

  // Add filters
  if (parsedQuery.filters) {
    Object.entries(parsedQuery.filters).forEach(([key, value]) => {
      params.append(key, value);
    });
  }

  return params;
}

// ─────────────────────────────────────────────────────────────
// MODULE APIS
// ─────────────────────────────────────────────────────────────

/**
 * Chats API
 * Fetches chat conversations based on search query
 */
export async function searchChats(parsedQuery, { signal }) {
  if (parsedQuery.isEmpty) {
    return [];
  }

  const params = buildQueryParams(parsedQuery);
  const url = `${API_BASE_URL}/chats/search?${params.toString()}`;

  try {
    const data = await apiFetch(url, { signal });
    
    // Transform API response to match expected format
    return (data.chats || data.results || data || []).map(chat => ({
      ...chat,
      _module: 'chats',
      _source: 'server',
      // Ensure required fields exist
      id: chat.chatid || chat.id,
      title: chat.title || chat.name || 'Untitled Chat',
    }));
  } catch (error) {
    console.error('[SearchAPI] Chats search failed:', error);
    throw error;
  }
}

/**
 * Users API
 * Fetches users based on search query
 */
export async function searchUsers(parsedQuery, { signal }) {
  if (parsedQuery.isEmpty) {
    return [];
  }

  const params = buildQueryParams(parsedQuery);
  const url = `${API_BASE_URL}/users/search?${params.toString()}`;

  try {
    const data = await apiFetch(url, { signal });
    
    return (data.users || data.results || data || []).map(user => ({
      ...user,
      _module: 'users',
      _source: 'server',
      id: user.zuid || user.id,
      name: user.dname || user.name || 'Unknown User',
    }));
  } catch (error) {
    console.error('[SearchAPI] Users search failed:', error);
    throw error;
  }
}

/**
 * Channels API
 * Fetches channels based on search query
 */
export async function searchChannels(parsedQuery, { signal }) {
  if (parsedQuery.isEmpty) {
    return [];
  }

  const params = buildQueryParams(parsedQuery);
  const url = `${API_BASE_URL}/channels/search?${params.toString()}`;

  try {
    const data = await apiFetch(url, { signal });
    
    return (data.channels || data.results || data || []).map(channel => ({
      ...channel,
      _module: 'channels',
      _source: 'server',
      id: channel.chid || channel.id,
      name: channel.cn || channel.name || 'Untitled Channel',
    }));
  } catch (error) {
    console.error('[SearchAPI] Channels search failed:', error);
    throw error;
  }
}

/**
 * Messages API
 * Fetches messages based on search query
 */
export async function searchMessages(parsedQuery, { signal }) {
  if (parsedQuery.isEmpty) {
    return [];
  }

  const params = buildQueryParams(parsedQuery);
  const url = `${API_BASE_URL}/messages/search?${params.toString()}`;

  try {
    const data = await apiFetch(url, { signal });
    
    return (data.messages || data.results || data || []).map(message => ({
      ...message,
      _module: 'messages',
      _source: 'server',
      id: message.msguid || message.id,
    }));
  } catch (error) {
    console.error('[SearchAPI] Messages search failed:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// API CONFIGURATION OBJECT
// Export this to pass to AdvancedSearch component
// ─────────────────────────────────────────────────────────────

export const searchModuleApis = {
  globalsearch: searchChats,
  users: searchUsers,
  channels: searchChannels,
  messages: searchMessages,
};

// ─────────────────────────────────────────────────────────────
// MOCK API (for development/testing)
// Import mock data and simulate server response
// ─────────────────────────────────────────────────────────────

import { mockData } from '../mock/servermockData';


/**
 * Mock API implementation that simulates server delay
 * Use this during development before backend APIs are ready
 */
export const mockModuleApis = {
  globalsearch: async (parsedQuery, { signal }) => {
    
    await new Promise(resolve => setTimeout(resolve, 300));
    if (signal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    const query = parsedQuery.keywords?.join(' ').toLowerCase() || '';
    
    if (!query) {
      return mockData.chats || [];
    }

    return (mockData.chats || []).filter(chat => 
      chat.title?.toLowerCase().includes(query) ||
      chat.name?.toLowerCase().includes(query)
    ).map(chat => ({
      ...chat,
      _module: chat.chat_type == 8 ? 'channels' : chat.chat_type == 1 ? 'users' : chat.chat_type == 11 ? 'threads' : chat.chat_type == 9 ? 'bot' : '',
      _source: 'server',
    }));
  },

  messages: async (parsedQuery, { signal }) => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Check if aborted
    if (signal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    // Simple filtering logic
    const query = parsedQuery.keywords?.join(' ').toLowerCase() || '';
    
    if (!query) {
      return mockData.messages || [];
    }
    
   
    const filteredMessages = (mockData.messages || []).filter(message => 
      message.message?.toLowerCase().includes(query)
    ).map(message => ({
      ...message,
      _module: 'messages',
      _source: 'mock-server',
    }));
    
    return filteredMessages;
  },

  users: async (parsedQuery, { signal }) => {
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check if aborted
    if (signal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    // Simple filtering logic
    const query = parsedQuery.keywords?.join(' ').toLowerCase() || '';
    
    if (!query) {
      return mockData.users || [];
    }
 
    const filteredUsers = (mockData.users || []).filter(user => 
      user.full_name?.toLowerCase().startsWith(query)||
      user.email?.toLowerCase().startsWith(query)||
      user.display_name?.toLowerCase().startsWith(query)
    ).map(user => ({
      ...user,
      _module: 'users',
      _source: 'mock-server',
    }));
    return filteredUsers;
  },
};

// ─────────────────────────────────────────────────────────────
// EXPORT DEFAULT
// Choose which API set to use based on environment
// ─────────────────────────────────────────────────────────────

const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API === 'true';

export default USE_MOCK_API ? mockModuleApis : searchModuleApis;
