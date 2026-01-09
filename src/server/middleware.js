/**
 * Express middleware configuration
 */

/**
 * Configure CORS middleware
 * @param {object} options - CORS options
 * @returns {function} Express middleware
 */
export function corsMiddleware(options = {}) {
  const {
    origin = '*',
    methods = 'GET, POST, OPTIONS',
    headers = 'Content-Type'
  } = options;

  return (req, res, next) => {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', methods);
    res.header('Access-Control-Allow-Headers', headers);

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }

    next();
  };
}
