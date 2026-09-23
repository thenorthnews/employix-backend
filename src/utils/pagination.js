const getPagination = (page = 1, limit = 10) => {
  page = Math.max(Number(page) || 1, 1);
  limit = Math.min(Math.max(Number(limit) || 10, 1), 100);

  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip,
  };
};

const getPaginationResponse = (total, page, limit) => {
  const totalPages = Math.ceil(total / limit);

  return {
    currentPage: page,
    limit,
    totalRecords: total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

export {
  getPagination,
  getPaginationResponse,
};