"""Safe public error codes; provider messages never cross this boundary."""

from flask import jsonify

STATUS = {
    "OUT_OF_STOCK": 409,
    "PRODUCT_UNAVAILABLE": 409,
    "INVALID_QUANTITY": 400,
    "INVALID_CART": 400,
    "INVALID_CUSTOMER": 400,
    "INVALID_PAYMENT": 400,
    "INVALID_INPUT": 400,
    "INVALID_COUPON": 400,
    "COUPON_NOT_ELIGIBLE": 409,
    "IDEMPOTENCY_CONFLICT": 409,
    "ORDER_NOT_FOUND": 404,
    "INVALID_STATUS_TRANSITION": 409,
    "REFUND_REQUIRED": 409,
    "FORBIDDEN": 403,
    "UNAUTHORIZED": 401,
    "RATE_LIMITED": 429,
    "PAYMENT_MISMATCH": 409,
    "PAYMENT_PROVIDER_MANAGED": 409,
    "ORDER_CANCELLED": 409,
    "SUPPORT_NOT_FOUND": 404,
    "SUPPORT_CLOSED": 409,
    "SUPPORT_RATE_LIMITED": 429,
    "SUPPORT_STALE": 409,
}
MESSAGES = {
    "STORE_NOT_CONFIGURED": "The store is not connected yet. Please try again later.",
    "DATABASE_ERROR": "The store service is temporarily unavailable.",
    "AUTH_UNAVAILABLE": "The account service is temporarily unavailable.",
    "INVALID_CREDENTIALS": "Email or password is incorrect.",
    "EMAIL_NOT_VERIFIED": "Please confirm your email before continuing.",
    "UNAUTHORIZED": "Please sign in to continue.",
    "FORBIDDEN": "An administrator account is required.",
    "INVALID_INPUT": "Please check the information and try again.",
    "OUT_OF_STOCK": "One or more products no longer have enough stock.",
    "PRODUCT_UNAVAILABLE": "A product in your bag is no longer available.",
    "PAYMENT_UNAVAILABLE": "This payment method is currently unavailable.",
    "PAYMENT_PROVIDER_ERROR": "Payment could not be opened. Retry the same order.",
    "PAYMENT_RECONCILIATION_REQUIRED": "Check this payment with the provider before cancelling.",
    "PAYMENT_EXPIRED": "This checkout has expired. Please refresh your orders.",
    "REFUND_REQUIRED": "A paid order requires a refund before cancellation.",
    "INVALID_ORIGIN": "This request must come from the store website.",
    "RATE_LIMITED": "Too many requests. Please try again shortly.",
    "SUPPORT_NOT_FOUND": "This support request could not be found.",
    "SUPPORT_CLOSED": "This request is closed. Please open a new request or ask staff to reopen it.",
    "SUPPORT_RATE_LIMITED": "The hourly support limit has been reached. Please try again later.",
    "SUPPORT_STALE": "This conversation changed. Refresh and review it before changing its status.",
}


class ApiError(Exception):
    def __init__(self, code: str, status: int | None = None):
        self.code = code
        self.status = status if status is not None else STATUS.get(code, 400)
        super().__init__(code)


def error_response(error: ApiError):
    response = jsonify(
        error={
            "code": error.code,
            "message": MESSAGES.get(error.code, error.code.replace("_", " ").capitalize() + "."),
        }
    )
    response.status_code = error.status
    response.headers["Cache-Control"] = "private, no-store"
    return response
