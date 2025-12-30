const mongoose = require('mongoose');

const surveyResponseSchema = new mongoose.Schema({
  q1: { type: String, required: true },
  q2: { type: String, required: true },
  q3: { type: [String], default: [] },
  q4: { type: String, required: true },
  q5: { type: Number, min: 1, max: 5, required: true },
  q6: { type: Number, min: 1, max: 5, required: true },
  q7: { type: Number, min: 1, max: 5, required: true },
  q8: { type: Number, min: 1, max: 5, required: true },
  q9: { type: Number, min: 1, max: 5, required: true },
  q10: { type: Number, min: 1, max: 5, required: true },
  q11: { type: String, required: true },
  q12: { type: String, required: true },
  q13: { type: Number, min: 1, max: 5, required: true },
  q14: { type: Number, min: 1, max: 5, required: true },
  q15: { type: Number, min: 1, max: 5, required: true },
  q16: { type: Number, min: 1, max: 5, required: true },
  q17: { type: Number, min: 1, max: 5, required: true },
  q18: { type: Number, min: 1, max: 5, required: true },
  q19: { type: Number, min: 1, max: 5, required: true },
  q20: { type: String },
  q21: { type: String },
  q22: { type: String, required: true },
  q23: { type: String, required: true },
  q24: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  cluster: { type: Number, default: 0 },
  sentiment: { type: Number, default: 0.0 },
}, {
  timestamps: true,
});

module.exports = mongoose.models.SurveyResponse || mongoose.model('SurveyResponse', surveyResponseSchema);

