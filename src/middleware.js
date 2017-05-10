import fetch from 'isomorphic-fetch';

import CALL_API from './CALL_API';
import { isRSAA, validateRSAA } from './validation';
import { InvalidRSAA, RequestError } from './errors' ;
import { normalizeTypeDescriptors, actionWith, fakeJsonResponse } from './util';

/**
 * A Redux middleware that processes RSAA actions.
 *
 * @type {ReduxMiddleware}
 * @access public
 */
function apiMiddleware({ getState }) {
  return (next) => async (action) => {
    // Do not process actions without a [CALL_API] property
    if (!isRSAA(action)) {
      return next(action);
    }

    // Try to dispatch an error request FSA for invalid RSAAs
    const validationErrors = validateRSAA(action);
    if (validationErrors.length) {
      const callAPI = action[CALL_API];
      if (callAPI.types && Array.isArray(callAPI.types)) {
        let requestType = callAPI.types[0];
        if (requestType && requestType.type) {
          requestType = requestType.type;
        }
        next({
          type: requestType,
          payload: new InvalidRSAA(validationErrors),
          error: true
        });
      }
      return;
    }

    // Parse the validated RSAA action
    const callAPI = action[CALL_API];
    let { endpoint, headers, options = {} } = callAPI;
    const { method, body, credentials, bailout, types, cache } = callAPI;
    const [requestType, successType, failureType] = normalizeTypeDescriptors(types);

    // Should we bail out?
    try {
      if ((typeof bailout === 'boolean' && bailout) ||
          (typeof bailout === 'function' && bailout(getState()))) {
        return;
      }
    } catch (e) {
      return next(await actionWith(
        {
          ...requestType,
          payload: new RequestError('[CALL_API].bailout function failed'),
          error: true
        },
        [action, getState()]
      ));
    }

    // Process [CALL_API].endpoint function
    if (typeof endpoint === 'function') {
      try {
        endpoint = endpoint(getState());
      } catch (e) {
        return next(await actionWith(
          {
            ...requestType,
            payload: new RequestError('[CALL_API].endpoint function failed'),
            error: true
          },
          [action, getState()]
        ));
      }
    }

    // Is it cached?
    if (cache) {
      try {
        if (await cache.has(endpoint)) {
          return next(await actionWith(
              successType,
              [action, getState(), fakeJsonResponse(await cache.get(endpoint))]
          ));
        }
      } catch (e) {
        return next(await actionWith(
          {
            ...requestType,
            payload: new RequestError(`[CALL_API].cache API function failed: ${e.message}`),
            error: true
          },
          [action, getState()]
        ));
      }
    }

    // Process [CALL_API].headers function
    if (typeof headers === 'function') {
      try {
        headers = headers(getState());
      } catch (e) {
        return next(await actionWith(
          {
            ...requestType,
            payload: new RequestError('[CALL_API].headers function failed'),
            error: true
          },
          [action, getState()]
        ));
      }
    }

    // Process [CALL_API].options function
    if (typeof options === 'function') {
      try {
        options = options(getState());
      } catch (e) {
        return next(await actionWith(
          {
            ...requestType,
            payload: new RequestError('[CALL_API].options function failed'),
            error: true
          },
          [action, getState()]
        ));
      }
    }

    // We can now dispatch the request FSA
    next(await actionWith(
      requestType,
      [action, getState()]
    ));

    try {
      // Make the API call
      var res = await fetch(endpoint, {
        ...options,
        method, body, credentials, headers: headers || {}
      });
    } catch(e) {
      // The request was malformed, or there was a network error
      return next(await actionWith(
        {
          ...requestType,
          payload: new RequestError(e.message),
          error: true
        },
        [action, getState()]
      ));
    }

    // Process the server response
    if (res.ok) {
      const action = await actionWith(
          successType,
          [action, getState(), res]
      );
      if (cache) {
        cache.set(endpoint, action.payload);
      }
      return next(action);
    } else {
      return next(await actionWith(
        {
          ...failureType,
          error: true
        },
        [action, getState(), res]
      ));
    }
  }
}

export { apiMiddleware };
