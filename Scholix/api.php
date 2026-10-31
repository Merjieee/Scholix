<?php
declare(strict_types=1);

require __DIR__ . '/config.php';
require __DIR__ . '/api/helpers.php';
start_app_session();

require_once __DIR__ . '/api/routes/auth.php';
require_once __DIR__ . '/api/routes/notifications.php';
require_once __DIR__ . '/api/routes/attendance.php';
require_once __DIR__ . '/api/routes/account.php';
require_once __DIR__ . '/api/routes/usage.php';
require_once __DIR__ . '/api/routes/data.php';
require_once __DIR__ . '/api/routes/documents.php';

$action = (string)($_GET['action'] ?? '');
$method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');

try {
    // School configuration contains display options only, so the login page can read it too.
    if ($action === 'config' && $method === 'GET') {
        json_response(['value'=>school_config()]);
    }

    handle_auth_route($action, $method);

    $account = require_account();
    handle_notifications_route($action, $method, $account);
    handle_attendance_route($action, $method, $account);
    handle_account_route($action, $method, $account);
    handle_usage_route($action, $method, $account);
    handle_data_route($action, $method, $account);
    handle_documents_route($action, $method, $account);

    json_response(['error' => 'Unknown action.'], 404);
} catch (Throwable $e) {
    error_log($e->__toString());
    json_response(['error' => 'The server could not complete the request. Check the PHP error log.'], 500);
}
