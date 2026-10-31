<?php
declare(strict_types=1);

$projectConfig = dirname(__DIR__, 2) . '/config.php';
if (!is_file($projectConfig)) $projectConfig = dirname(__DIR__, 3) . '/config.php';
require_once $projectConfig;
require_once dirname(__DIR__) . '/helpers.php';

function handle_auth_route(string $action, string $method): void {
    if ($action === 'login' && $method === 'POST') {
        $input = body_json();
        $email = strtolower(trim((string)($input['email'] ?? '')));
        $stmt = db()->prepare('SELECT id,name,email,password_hash,role,title,student_roll,grades_json FROM users WHERE email=? AND active=1 LIMIT 1');
        $stmt->execute([$email]);
        $row = $stmt->fetch();
        if (!$row || !password_verify((string)($input['password'] ?? ''), $row['password_hash'])) json_response(['error' => 'The email or password is incorrect. Please try again.'], 401);
        session_regenerate_id(true);
        $account = ['id'=>$row['id'],'name'=>$row['name'],'email'=>$row['email'],'role'=>$row['role'],'title'=>$row['title'],'studentRoll'=>$row['student_roll'],'grades'=>$row['grades_json'] === null ? null : json_decode($row['grades_json'],true)];
        if ($account['role'] === 'student') {
            $noteMigrationKey = 'student_req_notes_v2_' . preg_replace('/[^A-Za-z0-9_]/', '_', (string)$account['id']);
            if (store_value($noteMigrationKey) !== true) {
                $students = store_value('students');
                if (is_array($students)) {
                    $changedNotes = false;
                    $requirementKeys = ['goodMoral', 'form137', 'form138', 'psa', 'medical', 'clearance'];
                    foreach ($students as &$student) {
                        if (($student['roll'] ?? '') !== ($account['studentRoll'] ?? '')) continue;
                        foreach ($requirementKeys as $requirementKey) {
                            if (($student['requirements'][$requirementKey]['status'] ?? '') === 'Missing') {
                                $student['requirements'][$requirementKey]['note'] = 'Please upload here or submit to the handling office.';
                                $changedNotes = true;
                            }
                        }
                        break;
                    }
                    unset($student);
                    if ($changedNotes) save_value('students', $students);
                    save_value($noteMigrationKey, true);
                }
            }            $migrationKey = 'student_req_missing_v1_' . preg_replace('/[^A-Za-z0-9_]/', '_', (string)$account['id']);
            if (store_value($migrationKey) !== true) {
                $students = store_value('students');
                if (is_array($students)) {
                    $changed = false;
                    $requirementKeys = ['goodMoral', 'form137', 'form138', 'psa', 'medical', 'clearance'];
                    foreach ($students as &$student) {
                        if (($student['roll'] ?? '') !== ($account['studentRoll'] ?? '')) continue;
                        if (!is_array($student['requirements'] ?? null)) $student['requirements'] = [];
                        foreach ($requirementKeys as $requirementKey) {
                            $requirement = $student['requirements'][$requirementKey] ?? [];
                            if (!is_array($requirement)) $requirement = [];
                            $requirement['status'] = 'Missing';
                            $requirement['note'] = 'Please upload here or submit to the handling office.';
                            $student['requirements'][$requirementKey] = $requirement;
                        }
                        $changed = true;
                        break;
                    }
                    unset($student);
                    if ($changed) {
                        save_value('students', $students);
                        save_value($migrationKey, true);
                    }
                }
            }
        }
        $_SESSION['account'] = $account;
        if (!empty($input['remember'])) {
            $cookie = session_get_cookie_params();
            setcookie(session_name(), session_id(), ['expires'=>time()+60*60*24*30,'path'=>$cookie['path'],'domain'=>$cookie['domain'],'secure'=>$cookie['secure'],'httponly'=>true,'samesite'=>'Lax']);
        }
        json_response(['user'=>$account]);
    }
    if ($action === 'session' && $method === 'GET') json_response(['user'=>current_account()]);
    if ($action === 'logout' && $method === 'POST') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) { $p=session_get_cookie_params(); setcookie(session_name(),'',time()-42000,$p['path'],$p['domain'],$p['secure'],$p['httponly']); }
        session_destroy();
        json_response(['ok'=>true]);
    }
}
