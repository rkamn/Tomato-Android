module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    usesCleartextTraffic: process.env.TOMATO_ALLOW_HTTP === 'true',
  },
});
