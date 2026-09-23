

function success(res, data = null, message = 'OK') {
    return res.status(200).json({
        success: true,
        statusCode: 200,
        message,
        data
    });
}

function created(res, data = null, message = 'Created') {
    return res.status(201).json({
        success: true,
        statusCode: 201,
        message,
        data
    });
}

function badRequest(res, message = 'Bad Request') {
    return res.status(400).json({
        success: false,
        statusCode: 400,
        message
    });
}
function badRequestEmploymentHistory(res, message = 'UAN NUMBER NOT VALIDE') {
    return res.status(400).json({
        success: false,
        statusCode: 400,
        message
    });
}

function unauthorized(res, message = 'Unauthorized') {
    return res.status(401).json({
        success: false,
        statusCode: 401,
        message
    });
}

function forbidden(res, message = 'Forbidden') {
    return res.status(403).json({
        success: false,
        statusCode: 403,
        message
    });
}

function serverError(res, err) {
    return res.status(500).json({
        success: false,
        statusCode: 500,
        message: err.message || 'Server error'
    });
}

module.exports = {
    success,
    created,
    badRequest,
    unauthorized,
    forbidden,
    serverError,
    badRequestEmploymentHistory
}
