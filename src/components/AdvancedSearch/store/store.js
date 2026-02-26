/**
 * store.js
 * ─────────────────────────────────────────────────────────────
 * Redux store configuration.
 *
 * The search reducer is registered here.
 * Your app can extend this store with additional slices.
 *
 * Usage:
 *   import { store } from './store/store';
 *   <Provider store={store}> ... </Provider>
 */

import { configureStore } from '@reduxjs/toolkit';
import searchReducer from './searchSlice';

export const store = configureStore({
  reducer: {
    search: searchReducer,
    // add your other slices here:
    // user: userReducer,
    // chat: chatReducer,
  },
  middleware: (getDefault) =>
    getDefault({
      // ParsedQuery contains non-serializable function refs in some flows.
      // Redux Toolkit warns about non-serializable values — suppress for search.
      serializableCheck: {
        ignoredPaths: ['search.parsedQuery'],
      },
    }),
});

/** @typedef {ReturnType<typeof store.getState>} RootState */
/** @typedef {typeof store.dispatch} AppDispatch */