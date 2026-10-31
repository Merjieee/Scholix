<?php
declare(strict_types=1);


function body_json(): array {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) json_response(['error' => 'Invalid request body.'], 400);
    return $data;
}
function store_value(string $key): mixed {
    $stmt = db()->prepare('SELECT payload FROM app_data WHERE data_key = ?');
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    return $row ? json_decode($row['payload'], true) : null;
}
function save_value(string $key, mixed $value): void {
    $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) json_response(['error' => 'Data could not be encoded.'], 400);
    $stmt = db()->prepare('INSERT INTO app_data (data_key, payload) VALUES (?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload)');
    $stmt->execute([$key, $json]);
}
function school_config(): array {
    $config = store_value('school_config');
    return is_array($config) ? $config : [];
}
function school_requirements(): array {
    $requirements = school_config()['schoolRequirements'] ?? [];
    return is_array($requirements) ? $requirements : [];
}
function valid_requirement(string $key): bool {
    return in_array($key, ['goodMoral', 'form137', 'form138', 'psa', 'medical', 'clearance'], true);
}
function file_key(string $roll, string $requirement): string { return $roll . ':' . $requirement; }
function file_path(string $name): string { return dirname(__DIR__) . '/uploads/requirements/' . basename($name); }
function ensure_file_directory(): string {
    $directory = dirname(__DIR__) . '/uploads/requirements';
    if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) json_response(['error' => 'Document storage is unavailable.'], 500);
    return $directory;
}
function account_can_access_roll(array $account, string $roll, bool $adminOnly = false): bool {
    if ($account['role'] === 'admin') return true;
    return !$adminOnly && $account['role'] === 'student' && ($account['studentRoll'] ?? '') === $roll;
}
function push_notification(array $recipientIds, string $actorId, string $title, string $message, string $navKey = 'overview', string $eventKey = ''): void {
    $all = store_value('notifications');
    if (!is_array($all)) $all = [];
    foreach (array_unique(array_map('strval', $recipientIds)) as $recipientId) {
        if ($recipientId === '' || $recipientId === $actorId) continue;
        $items = $all[$recipientId] ?? [];
        if (!is_array($items)) $items = [];
        $existingIndex = null;
        if ($eventKey !== '') foreach ($items as $index => $item) {
            if (is_array($item) && ($item['eventKey'] ?? '') === $eventKey && empty($item['read'])) { $existingIndex = $index; break; }
        }
        if ($existingIndex !== null) {
            $items[$existingIndex]['title'] = $title;
            $items[$existingIndex]['message'] = $message;
            $items[$existingIndex]['navKey'] = $navKey;
            $items[$existingIndex]['createdAt'] = date(DATE_ATOM);
            $updated = $items[$existingIndex];
            unset($items[$existingIndex]);
            array_unshift($items, $updated);
            $items = array_values($items);
        } else {
            array_unshift($items, ['id'=>bin2hex(random_bytes(8)), 'eventKey'=>$eventKey, 'title'=>$title, 'message'=>$message, 'navKey'=>$navKey, 'createdAt'=>date(DATE_ATOM), 'read'=>false]);
        }
        $all[$recipientId] = array_slice($items, 0, 40);
    }
    save_value('notifications', $all);
}
function notify_requirement_change(array $student, string $actorId, string $title, string $studentMessage, string $staffMessage, string $eventKey, bool $notifyAdmins = false, bool $notifyStaff = true): void {
    $stmt = db()->prepare("SELECT id FROM users WHERE role='student' AND student_roll=? AND active=1 LIMIT 1");
    $stmt->execute([(string)($student['roll'] ?? '')]);
    $linkedId = $stmt->fetchColumn();
    $studentId = $linkedId === false ? '' : (string)$linkedId;
    $staffIds = [];
    $roll = (string)($student['roll'] ?? '');
    $code = preg_match('/^(\d+[A-Z])/i', $roll, $match) ? strtoupper($match[1]) : '';
    $sections = store_value('sections');
    if (is_array($sections)) foreach ($sections as $section) {
        if (($section['code'] ?? '') === $code && ($section['grade'] ?? '') === ($student['grade'] ?? '') && !empty($section['adviserId'])) $staffIds[] = (string)$section['adviserId'];
    }
    if ($notifyAdmins) {
        $admins = db()->query("SELECT id FROM users WHERE role='admin' AND active=1")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($admins as $id) $staffIds[] = (string)$id;
    }
    if ($studentId !== '' && $studentId !== $actorId) push_notification([$studentId], $actorId, $title, $studentMessage, 'requirements', $eventKey);
    if ($notifyStaff) push_notification($staffIds, $actorId, $title, $staffMessage, 'requirements', $eventKey);
}
function notify_student_change(array $student, string $actorId, string $title, string $message, string $navKey, bool $notifyAdmins = false, string $eventKey = ''): void {
    $recipients = [];
    $studentAccount = db()->prepare("SELECT id FROM users WHERE role='student' AND student_roll=? AND active=1 LIMIT 1");
    $studentAccount->execute([(string)($student['roll'] ?? '')]);
    $linkedId = $studentAccount->fetchColumn();
    if ($linkedId !== false) $recipients[] = (string)$linkedId;
    $roll = (string)($student['roll'] ?? '');
    $code = preg_match('/^(\d+[A-Z])/i', $roll, $match) ? strtoupper($match[1]) : '';
    $sections = store_value('sections');
    if (is_array($sections)) foreach ($sections as $section) {
        if (($section['code'] ?? '') === $code && ($section['grade'] ?? '') === ($student['grade'] ?? '') && !empty($section['adviserId'])) $recipients[] = (string)$section['adviserId'];
    }
    if ($notifyAdmins) {
        $admins = db()->query("SELECT id FROM users WHERE role='admin' AND active=1")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($admins as $id) $recipients[] = (string)$id;
    }
    push_notification($recipients, $actorId, $title, $message, $navKey, $eventKey);
}

function notify_student_and_adviser(array $student, string $actorId, string $title, string $studentMessage, string $staffMessage, string $navKey, string $eventKey, bool $notifyAdmins = false, ?string $staffTitle = null): void {
    $stmt = db()->prepare("SELECT id FROM users WHERE role='student' AND student_roll=? AND active=1 LIMIT 1");
    $stmt->execute([(string)($student['roll'] ?? '')]);
    $linkedId = $stmt->fetchColumn();
    $staffIds = [];
    $roll = (string)($student['roll'] ?? '');
    $code = preg_match('/^(\d+[A-Z])/i', $roll, $match) ? strtoupper($match[1]) : '';
    $sections = store_value('sections');
    if (is_array($sections)) foreach ($sections as $section) {
        if (($section['code'] ?? '') === $code && ($section['grade'] ?? '') === ($student['grade'] ?? '') && !empty($section['adviserId'])) $staffIds[] = (string)$section['adviserId'];
    }
    if ($notifyAdmins) {
        $admins = db()->query("SELECT id FROM users WHERE role='admin' AND active=1")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($admins as $id) $staffIds[] = (string)$id;
    }
    if ($linkedId !== false && (string)$linkedId !== $actorId) push_notification([(string)$linkedId], $actorId, $title, $studentMessage, $navKey, $eventKey);
    push_notification($staffIds, $actorId, $staffTitle ?? $title, $staffMessage, $navKey, $eventKey);
}
function notify_attendance_change(array $student, string $actorId, string $actorName, string $actorRole, float $attendance, int $absences, int $lateArrivals, bool $notifyAdmins): void {
    $studentStmt = db()->prepare("SELECT id FROM users WHERE role='student' AND student_roll=? AND active=1 LIMIT 1");
    $studentStmt->execute([(string)($student['roll'] ?? '')]);
    $linkedId = $studentStmt->fetchColumn();
    $staffIds = [];
    $roll = (string)($student['roll'] ?? '');
    $code = preg_match('/^(\d+[A-Z])/i', $roll, $match) ? strtoupper($match[1]) : '';
    $sections = store_value('sections');
    if (is_array($sections)) foreach ($sections as $section) {
        if (($section['code'] ?? '') === $code && ($section['grade'] ?? '') === ($student['grade'] ?? '') && !empty($section['adviserId'])) $staffIds[] = (string)$section['adviserId'];
    }
    if ($notifyAdmins) {
        $admins = db()->query("SELECT id FROM users WHERE role='admin' AND active=1")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($admins as $id) $staffIds[] = (string)$id;
    }
    $percentage = number_format($attendance, 1) . '%';
    $studentMessage = 'Your attendance is now ' . $percentage . ', with ' . $absences . ' absences and ' . $lateArrivals . ' late arrivals. Updated by ' . $actorRole . ' ' . $actorName . '.';
    $staffMessage = $actorRole . ' ' . $actorName . ' updated ' . (string)($student['name'] ?? 'a student') . "'s attendance to " . $percentage . ', with ' . $absences . ' absences and ' . $lateArrivals . ' late arrivals.';
    $eventKey = 'attendance:' . $roll . ':' . $absences . ':' . $lateArrivals;
    if ($linkedId !== false && (string)$linkedId !== $actorId) push_notification([(string)$linkedId], $actorId, 'Attendance updated', $studentMessage, 'attendance', $eventKey);
    push_notification($staffIds, $actorId, 'Attendance updated', $staffMessage, 'attendance', $eventKey);
}
