const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  content: {
    type: String,
    required: true,
    trim: true,
  },
  category: {
    type: String,
  },
  meta: {
    type: String,
    required: true,
    trim: true,
  },
  tags: {
    type: [String],
  },
  thumbnail: {
    type: Object,
    url: String,
    public_id: String,
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  isDraft: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.models.Post || mongoose.model('Post', postSchema);

