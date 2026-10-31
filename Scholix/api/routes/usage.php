<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/../helpers.php';

function handle_usage_route(string $action, string $method, array $account): void {
    if (!in_array($action, ['usage_time', 'usage_time_add'], true)) return;

    $allUsage = store_value('account_usage_seconds');
    if (!is_array($allUsage)) $allUsage = store_value('student_usage_seconds'); // Preserve existing student usage history.
    if (!is_array($allUsage)) $allUsage = [];
    $accountId = (string)($account['id'] ?? '');
    if ($accountId === '') json_response(['error'=>'The signed-in account is unavailable.'],401);

    if ($action === 'usage_time' && $method === 'GET') {
        $weekStart = trim((string)($_GET['weekStart'] ?? ''));
        $start = DateTimeImmutable::createFromFormat('!Y-m-d', $weekStart);
        if (!$start || $start->format('Y-m-d') !== $weekStart || $start->format('N') !== '1') {
            json_response(['error'=>'Choose a valid Monday for the requested week.'],400);
        }
        $days = [];
        $accountDays = $allUsage[$accountId] ?? [];
        if (!is_array($accountDays)) $accountDays = [];
        for ($index = 0; $index < 7; $index++) {
            $date = $start->modify('+' . $index . ' days')->format('Y-m-d');
            $days[$date] = max(0, (int)($accountDays[$date] ?? 0));
        }
        json_response(['value'=>['weekStart'=>$weekStart, 'days'=>$days]]);
    }

    if ($action === 'usage_time_add' && $method === 'POST') {
        $input = body_json();
        $date = trim((string)($input['date'] ?? ''));
        $dateObject = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        $seconds = filter_var($input['seconds'] ?? null, FILTER_VALIDATE_INT);
        if (!$dateObject || $dateObject->format('Y-m-d') !== $date || $seconds === false || $seconds < 1 || $seconds > 90) {
            json_response(['error'=>'Usage time entry is invalid.'],400);
        }
        $accountDays = $allUsage[$accountId] ?? [];
        if (!is_array($accountDays)) $accountDays = [];
        $accountDays[$date] = min(86400, max(0, (int)($accountDays[$date] ?? 0)) + $seconds);

        $cutoff = (new DateTimeImmutable('today'))->modify('-89 days')->format('Y-m-d');
        foreach (array_keys($accountDays) as $storedDate) {
            if (!is_string($storedDate) || $storedDate < $cutoff || $storedDate > $date) unset($accountDays[$storedDate]);
        }
        $allUsage[$accountId] = $accountDays;
        save_value('student_usage_seconds', $allUsage);
        json_response(['ok'=>true, 'date'=>$date, 'seconds'=>$accountDays[$date]]);
    }
}
