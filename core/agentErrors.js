class ApprovalPauseError extends Error {
  constructor(approvalId, message = "Human approval required before write.") {
    super(message);
    this.name = "ApprovalPauseError";
    this.code = "APPROVAL_PAUSE";
    this.approvalId = approvalId;
  }
}

module.exports = { ApprovalPauseError };
