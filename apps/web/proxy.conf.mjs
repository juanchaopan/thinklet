// Development proxy for `ng serve`: requests to /api go to the api, the same
// way the /api rewrite in vercel.json forwards them on staging. API_ORIGIN
// names the api's origin; without it the local api's default port is used.
// `xfwd` adds the browser's address to X-Forwarded-For, the header the api
// reads a request's source from in development (CLIENT_IP_HEADER).
const target = process.env['API_ORIGIN'] || 'http://localhost:3000';

export default {
  '/api': {
    target,
    changeOrigin: true,
    xfwd: true,
  },
};
