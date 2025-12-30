const jwt = require('jsonwebtoken');

const createActivationToken = (payload) => {
  return jwt.sign(payload, process.env.ACTIVATION_TOKEN_SECRET || process.env.NEXTAUTH_SECRET, {
    expiresIn: '2d',
  });
};

const createResetToken = (payload) => {
  return jwt.sign(payload, process.env.RESET_TOKEN_SECRET || process.env.NEXTAUTH_SECRET, {
    expiresIn: '6h',
  });
};

module.exports = {
  createActivationToken,
  createResetToken
};

