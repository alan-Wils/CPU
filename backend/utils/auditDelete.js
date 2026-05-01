async function auditDelete(prisma, req, payload) {
  const {
    area = "System",
    batch = null,
    recordType = "Record",
    recordId = "",
    recordData = null,
  } = payload || {};

  await prisma.taskLog.create({
    data: {
      companyId: req.user.companyId,
      area,
      batch: batch ? String(batch) : recordId ? String(recordId) : null,
      task: "Deleted Record",
      output: `${recordType} deleted: ${recordId}`,
      data: {
        deletedRecordType: recordType,
        deletedRecordId: recordId,
        deletedRecordData: recordData,
        deletedBy: {
          userId: req.user.userId,
          username: req.user.username,
          role: req.user.role,
        },
        deletedAt: new Date().toISOString(),
      },
      createdBy: req.user.userId,
    },
  });
}

module.exports = auditDelete;