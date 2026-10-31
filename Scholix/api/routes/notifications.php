<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/../helpers.php';

function handle_notifications_route(string $action, string $method, array $account): void {
    if ($action === 'notifications' && $method === 'GET') {
        $all = store_value('notifications');
        if (!is_array($all)) $all = [];
        $items = $all[(string)$account['id']] ?? [];
        if (!is_array($items)) $items = [];
        if (($account['role'] ?? '') === 'student') {
            $legacySeen = [];
            $legacyRecordSeen = [];
            $cleanItems = [];
            $legacyLabels = ['Good moral certificate','Form 137','Form 138','PSA birth certificate','Medical certificate','Clearance'];
            $accountNamePattern = preg_quote((string)($account['name'] ?? ''), '/');
            foreach ($items as $item) {
                if ($accountNamePattern !== '' && is_array($item) && ($item['title'] ?? '') === 'Attendance updated' && preg_match('/^' . $accountNamePattern . "'s attendance is now (.+)$/i", (string)($item['message'] ?? ''), $attendanceMatch)) {
                    $item['message'] = 'Your attendance is now ' . $attendanceMatch[1];
                }
                if (is_array($item) && ($item['title'] ?? '') === 'Requirement updated' && preg_match('/^(.+) is now Missing for (.+)\.$/', (string)($item['message'] ?? ''), $legacyMatch) && strcasecmp(trim($legacyMatch[2]), (string)($account['name'] ?? '')) === 0) {
                    $label = trim($legacyMatch[1]);
                    if (!in_array($label, $legacyLabels, true)) { $cleanItems[] = $item; continue; }
                    if (isset($legacySeen[$label])) continue;
                    $legacySeen[$label] = true;
                    $item['title'] = 'Document status updated';
                    $item['message'] = 'The school updated your ' . $label . ' status to Missing. Please upload a corrected document or contact the school office.';
                }
                if (is_array($item) && ($item['title'] ?? '') === 'Student record updated' && ($item['message'] ?? '') === 'The school updated information in your student record.') {
                    $minute = substr((string)($item['createdAt'] ?? ''), 0, 16);
                    $signature = 'legacy-record:' . $minute;
                    if ($minute !== '' && isset($legacyRecordSeen[$signature])) continue;
                    if ($minute !== '') $legacyRecordSeen[$signature] = true;
                }
                $cleanItems[] = $item;
            }
            if (count($cleanItems) !== count($items) || $cleanItems !== $items) {
                $items = $cleanItems;
                $all[(string)$account['id']] = $items;
                save_value('notifications', $all);
            }
        }
        $unread = count(array_filter($items, fn($item) => empty($item['read'])));
        json_response(['items'=>$items,'unread'=>$unread]);
    }
    if ($action === 'notifications_read' && $method === 'POST') {
        $input = body_json();
        $notificationId = (string)($input['id'] ?? '');
        $all = store_value('notifications');
        if (!is_array($all)) $all = [];
        $items = $all[(string)$account['id']] ?? [];
        if (!is_array($items)) $items = [];
        foreach ($items as &$item) {
            if ($notificationId === '' || ($item['id'] ?? '') === $notificationId) $item['read'] = true;
        }
        unset($item);
        $all[(string)$account['id']] = $items;
        save_value('notifications', $all);
        json_response(['ok'=>true]);
    }
    if ($action === 'notifications_delete' && $method === 'POST') {
        $input = body_json();
        $notificationId = trim((string)($input['id'] ?? ''));
        if ($notificationId === '') json_response(['error'=>'Choose a notification to delete.'],400);
        $all = store_value('notifications');
        if (!is_array($all)) $all = [];
        $accountId = (string)$account['id'];
        $items = $all[$accountId] ?? [];
        if (!is_array($items)) $items = [];
        $all[$accountId] = array_values(array_filter($items, fn($item) => !is_array($item) || (string)($item['id'] ?? '') !== $notificationId));
        save_value('notifications', $all);
        json_response(['ok'=>true]);
    }
}
