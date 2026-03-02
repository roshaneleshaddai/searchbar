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
  
  },
  middleware: (getDefault) =>
    getDefault({
      serializableCheck: {
        ignoredPaths: ['search.parsedQuery'],
      },
    }),
});

/** @typedef {ReturnType<typeof store.getState>} RootState */
/** @typedef {typeof store.dispatch} AppDispatch */