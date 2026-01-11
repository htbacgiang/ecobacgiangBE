const mongoose = require('mongoose');

const recruitmentApplicationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  introduction: {
    type: String,
    default: ''
  },
  jobTitle: {
    type: String,
    required: true,
    trim: true
  },
  jobId: {
    type: String,
    default: ''
  },
  cvFileName: {
    type: String,
    default: null
  },
  cvFilePath: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'reviewing', 'accepted', 'rejected'],
    default: 'pending'
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for better query performance
recruitmentApplicationSchema.index({ email: 1 });
recruitmentApplicationSchema.index({ status: 1 });
recruitmentApplicationSchema.index({ createdAt: -1 });
recruitmentApplicationSchema.index({ jobTitle: 1 });

module.exports = mongoose.models.RecruitmentApplication || mongoose.model('RecruitmentApplication', recruitmentApplicationSchema);
