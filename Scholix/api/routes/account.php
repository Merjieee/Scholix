<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/../helpers.php';

function handle_account_route(string $action, string $method, array $account): void {
    if ($action === 'accounts' && $method === 'GET') {
        if (($account['role'] ?? '') === 'admin') {
            $rows = db()->query("SELECT id,name,email,role,title,student_roll,grades_json FROM users WHERE active=1 ORDER BY FIELD(role,'admin','teacher','student'), name")->fetchAll();
        } else {
            $rows = db()->query("SELECT id,name,email,role,title,student_roll,grades_json FROM users WHERE active=1 AND role IN ('admin','teacher') ORDER BY FIELD(role,'admin','teacher'), name")->fetchAll();
        }
        $users = array_map(static fn(array $row): array => [
            'id'=>$row['id'], 'name'=>$row['name'], 'email'=>$row['email'], 'role'=>$row['role'],
            'title'=>$row['title'], 'studentRoll'=>$row['student_roll'],
            'grades'=>json_decode((string)($row['grades_json'] ?? 'null'), true)
        ], $rows);
        json_response(['value'=>$users]);
    }

    if ($action === 'change_password' && $method === 'POST') {
        $input = body_json();
        $currentPassword = (string)($input['currentPassword'] ?? '');
        $newPassword = (string)($input['newPassword'] ?? '');
        $confirmPassword = (string)($input['confirmPassword'] ?? '');
        if ($currentPassword === '' || $newPassword === '' || $confirmPassword === '') json_response(['error'=>'Complete all password fields.'],400);
        if (strlen($newPassword) < 8) json_response(['error'=>'Use at least 8 characters for the new password.'],400);
        if (!hash_equals($newPassword, $confirmPassword)) json_response(['error'=>'The new password and confirmation do not match.'],400);
        $stmt = db()->prepare('SELECT password_hash FROM users WHERE id=? AND active=1 LIMIT 1');
        $stmt->execute([$account['id']]);
        $passwordHash = $stmt->fetchColumn();
        if (!$passwordHash || !password_verify($currentPassword, (string)$passwordHash)) json_response(['error'=>'The current password is incorrect.'],401);
        $update = db()->prepare('UPDATE users SET password_hash=? WHERE id=?');
        $update->execute([password_hash($newPassword, PASSWORD_DEFAULT), $account['id']]);
        json_response(['ok'=>true]);
    }
}
