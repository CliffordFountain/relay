use tonic::Status;

/// Map a sqlx error to a tonic gRPC Status.
pub fn sqlx_to_status(err: sqlx::Error) -> Status {
    match &err {
        sqlx::Error::RowNotFound => Status::not_found("resource not found"),
        sqlx::Error::Database(db_err) => {
            let code = db_err.code().unwrap_or_default();
            // 23505 = unique_violation
            if code == "23505" {
                Status::already_exists("resource already exists")
            // 23503 = foreign_key_violation
            } else if code == "23503" {
                Status::not_found("referenced resource not found")
            // 23514 = check_violation
            } else if code == "23514" {
                Status::invalid_argument(format!("constraint violation: {db_err}"))
            } else {
                tracing::error!("database error (code={}): {}", code, db_err);
                Status::internal("internal database error")
            }
        }
        _ => {
            tracing::error!("sqlx error: {}", err);
            Status::internal("internal database error")
        }
    }
}
