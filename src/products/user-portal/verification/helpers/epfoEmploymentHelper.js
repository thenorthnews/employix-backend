/**
 * Helper to parse, sort, and identify the latest/active employer from EPFO records.
 */

/**
 * Safely parse a date string in DD/MM/YYYY format to a JavaScript Date object
 * @param {string} dateStr - Date string, e.g. '01/07/2024' or ISO string
 * @returns {Date} Parsed date object
 */
const parseDateDMY = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return new Date(0);

  const trimmed = dateStr.trim();
  // Handle DD/MM/YYYY
  const parts = trimmed.split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Fallback to standard parser
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? new Date(0) : parsed;
};

/**
 * Identify the latest / current employment record from an EPFO array:
 * 1. Checks records where exitDate === null (active employment).
 * 2. If multiple active records exist (or if none are active), compares joiningDate (DD/MM/YYYY)
 *    and picks the record with the most recent joining date.
 *
 * @param {Array} records - Array of EPFO employment objects
 * @returns {Object|null} Identified latest record
 */
const identifyLatestEmployment = (records = []) => {
  if (!Array.isArray(records) || records.length === 0) return null;

  // 1. Filter active employments (exitDate is null, undefined, empty, or 'null')
  const activeRecords = records.filter((r) => {
    const exit = r.exitDate;
    return (
      exit === null ||
      exit === undefined ||
      String(exit).trim() === '' ||
      String(exit).toLowerCase() === 'null'
    );
  });

  // Exactly 1 active record found -> Return it
  if (activeRecords.length === 1) {
    return activeRecords[0];
  }

  // If multiple active records exist, choose the one with the latest joiningDate.
  // If no active records exist (all have exited), choose from all records by latest joiningDate.
  const candidatePool = activeRecords.length > 1 ? activeRecords : records;

  const sorted = [...candidatePool].sort((a, b) => {
    const dateA = parseDateDMY(a.joiningDate);
    const dateB = parseDateDMY(b.joiningDate);
    return dateB.getTime() - dateA.getTime();
  });

  return sorted[0] || null;
};

/**
 * Tag employment records with isCurrent: true for the identified latest record
 * @param {Array} records - Raw EPFO records
 * @returns {Array} Records with isCurrent: boolean
 */
const tagEmploymentRecordsWithCurrent = (records = []) => {
  if (!Array.isArray(records) || records.length === 0) return [];
  const latest = identifyLatestEmployment(records);

  return records.map((record) => {
    const isThisLatest =
      latest &&
      record.employerName === latest.employerName &&
      (record.memberId ? record.memberId === latest.memberId : record.joiningDate === latest.joiningDate);

    return {
      employerName: record.employerName,
      joiningDate: record.joiningDate || null,
      exitDate: record.exitDate || null,
      memberId: record.memberId || null,
      name: record.name || null,
      guardian: record.guardian || null,
      isCurrent: Boolean(isThisLatest),
    };
  });
};

/**
/**
 * Identify the most recent past/previous employment record (non-current, with exitDate).
 * For reference checks, candidates/referees typically verify past completed employment
 * rather than their current active company.
 *
 * @param {Array} records - Array of EPFO employment objects
 * @returns {Object|null} Identified past record
 */
const identifyPreviousEmployment = (records = []) => {
  if (!Array.isArray(records) || records.length === 0) return null;

  // 1. Filter records that are NOT current and have a valid exitDate
  const pastRecords = records.filter((r) => {
    if (r.isCurrent) return false;
    const exit = r.exitDate;
    const isExitEmpty =
      exit === null ||
      exit === undefined ||
      String(exit).trim() === '' ||
      String(exit).toLowerCase() === 'null';
    return !isExitEmpty;
  });

  if (pastRecords.length > 0) {
    // Sort past records by exitDate (most recent exit date first), then joiningDate
    const sorted = [...pastRecords].sort((a, b) => {
      const exitA = parseDateDMY(a.exitDate);
      const exitB = parseDateDMY(b.exitDate);
      if (exitB.getTime() !== exitA.getTime()) {
        return exitB.getTime() - exitA.getTime();
      }
      const joinA = parseDateDMY(a.joiningDate);
      const joinB = parseDateDMY(b.joiningDate);
      return joinB.getTime() - joinA.getTime();
    });
    return sorted[0];
  }

  // 2. If no records with exitDate, check if there are 2 or more records: take the 2nd record
  if (records.length >= 2) {
    const nonCurrent = records.find((r) => !r.isCurrent);
    return nonCurrent || records[1];
  }

  // 3. Fallback: single record
  return records[0] || null;
};

/**
 * Retrieve candidate's company name from EPFO records or Manual Employment.
 * Supports preferPastCompany (defaults to true for reference checks to avoid current company).
 *
 * @param {string|ObjectId} userId - Candidate user ID
 * @param {Object} options - { preferPastCompany: boolean }
 * @returns {Promise<{ companyName: string, isCurrent: boolean, source: string, joiningDate: string, exitDate: string, allCompanies: Array }>}
 */
const getLatestCandidateCompany = async (userId, { preferPastCompany = true } = {}) => {
  try {
    const EmploymentVerification = require('../../models/employmentVerification.model');
    const ManualEmployment = require('../../models/manualEmployment.model');

    // 1. Try EPFO records
    const epfoDoc = await EmploymentVerification.findOne({ userId })
      .sort({ createdAt: -1 })
      .lean();

    if (epfoDoc && Array.isArray(epfoDoc.records) && epfoDoc.records.length > 0) {
      const records = epfoDoc.records;

      // Determine target record based on preference
      let targetRec = null;
      if (preferPastCompany) {
        targetRec = identifyPreviousEmployment(records);
      }
      if (!targetRec) {
        targetRec = records.find((r) => r.isCurrent) || identifyLatestEmployment(records);
      }

      const allCompanies = records.map((r) => ({
        companyName: r.employerName,
        joiningDate: r.joiningDate,
        exitDate: r.exitDate,
        isCurrent: Boolean(r.isCurrent || !r.exitDate),
      }));

      if (targetRec && targetRec.employerName) {
        const isCurrent = Boolean(
          targetRec.isCurrent ||
          targetRec.exitDate === null ||
          targetRec.exitDate === undefined ||
          String(targetRec.exitDate).trim() === '' ||
          String(targetRec.exitDate).toLowerCase() === 'null'
        );

        return {
          companyName: targetRec.employerName,
          isCurrent,
          source: 'EPFO',
          joiningDate: targetRec.joiningDate,
          exitDate: targetRec.exitDate,
          allCompanies,
        };
      }
    }

    // 2. Try Manual Employment records
    if (preferPastCompany) {
      const manualPast = await ManualEmployment.findOne({ userId, isCurrent: false })
        .sort({ endDate: -1, createdAt: -1 })
        .lean();

      if (manualPast && manualPast.companyName) {
        return {
          companyName: manualPast.companyName,
          isCurrent: false,
          source: 'MANUAL',
          joiningDate: manualPast.startDate,
          exitDate: manualPast.endDate,
          allCompanies: [
            {
              companyName: manualPast.companyName,
              joiningDate: manualPast.startDate,
              exitDate: manualPast.endDate,
              isCurrent: false,
            },
          ],
        };
      }
    }

    const manualDoc = await ManualEmployment.findOne({ userId })
      .sort({ isCurrent: -1, createdAt: -1 })
      .lean();

    if (manualDoc && manualDoc.companyName) {
      return {
        companyName: manualDoc.companyName,
        isCurrent: Boolean(manualDoc.isCurrent),
        source: 'MANUAL',
        joiningDate: manualDoc.startDate,
        exitDate: manualDoc.endDate,
        allCompanies: [
          {
            companyName: manualDoc.companyName,
            joiningDate: manualDoc.startDate,
            exitDate: manualDoc.endDate,
            isCurrent: Boolean(manualDoc.isCurrent),
          },
        ],
      };
    }

    return {
      companyName: '',
      isCurrent: false,
      source: 'NONE',
      allCompanies: [],
    };
  } catch (err) {
    console.error('Error fetching candidate company:', err);
    return {
      companyName: '',
      isCurrent: false,
      source: 'ERROR',
      allCompanies: [],
    };
  }
};

module.exports = {
  parseDateDMY,
  identifyLatestEmployment,
  identifyPreviousEmployment,
  tagEmploymentRecordsWithCurrent,
  getLatestCandidateCompany,
};
