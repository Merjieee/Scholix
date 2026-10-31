<?php
declare(strict_types=1);
require __DIR__ . '/config.php';
start_app_session();

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
function valid_requirement(string $key): bool {
    return in_array($key, ['goodMoral', 'form137', 'form138', 'psa', 'medical', 'clearance'], true);
}
function file_key(string $roll, string $requirement): string { return $roll . ':' . $requirement; }
function file_path(string $name): string { return __DIR__ . '/uploads/requirements/' . basename($name); }
function ensure_file_directory(): string {
    $directory = __DIR__ . '/uploads/requirements';
    if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) json_response(['error' => 'Document storage is unavailable.'], 500);
    return $directory;
}
function account_can_access_roll(array $account, string $roll, bool $adminOnly = false): bool {
    if ($account['role'] === 'admin') return true;
    return !$adminOnly && $account['role'] === 'student' && ($account['studentRoll'] ?? '') === $roll;
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
try {
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

    $account = require_account();
    if ($action === 'attendance' && $method === 'POST') {
        if (!in_array($account['role'], ['admin', 'teacher'], true)) json_response(['error'=>'Administrator or teacher access is required.'],403);
        $input = body_json();
        $studentId = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
        $absences = filter_var($input['absences'] ?? null, FILTER_VALIDATE_INT);
        $lateArrivals = filter_var($input['lateArrivals'] ?? null, FILTER_VALIDATE_INT);
        if ($studentId === false || $studentId === null || $absences === false || $absences === null || $absences < 0 || $absences > 180 || $lateArrivals === false || $lateArrivals === null || $lateArrivals < 0) {
            json_response(['error'=>'Absences must be 0–180 and late arrivals must be a whole number of 0 or more.'],400);
        }
        $students = store_value('students');
        if (!is_array($students)) json_response(['error'=>'Student records are unavailable.'],500);
        $found = false;
        $attendance = 0.0;
        foreach ($students as &$student) {
            if ((int)($student['id'] ?? 0) !== $studentId) continue;
            if ($account['role'] === 'teacher') {
                $sections = store_value('sections');
                if (!is_array($sections)) $sections = [];
                $roll = (string)($student['roll'] ?? '');
                $sectionMatch = preg_match('/^(\d+[A-Z])/i', $roll, $matches);
                $sectionCode = $sectionMatch ? strtoupper($matches[1]) : '';
                $hasAssignedSection = false;
                foreach ($sections as $section) {
                    if (($section['adviserId'] ?? '') === $account['id'] && ($section['code'] ?? '') === $sectionCode && ($section['grade'] ?? '') === ($student['grade'] ?? '')) {
                        $hasAssignedSection = true;
                        break;
                    }
                }
                if (!$hasAssignedSection) json_response(['error'=>'This student is outside your assigned sections.'],403);
            }
            $student['absences'] = $absences;
            $student['lateArrivals'] = $lateArrivals;
            $student['attendance'] = round(max(0, (180 - $absences) / 180 * 100), 1);
            $attendance = $student['attendance'];
            $found = true;
            break;
        }
        unset($student);
        if (!$found) json_response(['error'=>'Student record not found.'],404);
        save_value('students', $students);
        json_response(['ok'=>true,'attendance'=>$attendance,'absences'=>$absences,'lateArrivals'=>$lateArrivals]);
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
    if ($action === 'get' && $method === 'GET') {
        $key = (string)($_GET['key'] ?? '');
        if (!in_array($key, ['students','sections','profiles'], true)) json_response(['error'=>'Unknown data set.'],404);
        $value = store_value($key);
        if ($key === 'students' && is_array($value)) {
            // Correct the old "received" note when a linked student requirement is marked Missing.
            $allStudents = $value;
            $studentAccounts = db()->query("SELECT student_roll FROM users WHERE role='student' AND student_roll IS NOT NULL")->fetchAll();
            $studentRolls = array_map('strval', array_column($studentAccounts, 'student_roll'));
            $notesChanged = false;
            foreach ($allStudents as &$studentRecord) {
                if (!in_array((string)($studentRecord['roll'] ?? ''), $studentRolls, true)) continue;
                if (!is_array($studentRecord['requirements'] ?? null)) continue;
                foreach ($studentRecord['requirements'] as &$requirementRecord) {
                    if (!is_array($requirementRecord)) continue;
                    if (($requirementRecord['status'] ?? '') === 'Missing') {
                        $requirementRecord['note'] = 'Please upload here or submit to the handling office.';
                        $notesChanged = true;
                    }
                }
                unset($requirementRecord);
            }
            unset($studentRecord);
            if ($notesChanged) save_value('students', $allStudents);
            $value = $allStudents;
            if ($account['role'] === 'teacher') $value = array_values(array_filter($value, fn($s)=>in_array($s['grade']??'',($account['grades']??[]),true)));
            elseif ($account['role'] === 'student') $value = array_values(array_filter($value, fn($s)=>($s['roll']??'')===($account['studentRoll']??'')));

            // Merge the latest student account profile into the roster response.
            // This also repairs older roster rows whose avatar was saved only in profiles.
            $profiles = store_value('profiles');
            if (!is_array($profiles)) $profiles = [];
            $studentProfiles = db()->query("SELECT id, student_roll FROM users WHERE role='student' AND student_roll IS NOT NULL")->fetchAll();
            $profileByRoll = [];
            foreach ($studentProfiles as $studentAccount) {
                $roll = (string)$studentAccount['student_roll'];
                if ($roll !== '' && isset($profiles[$studentAccount['id']]) && is_array($profiles[$studentAccount['id']])) {
                    $profileByRoll[$roll] = $profiles[$studentAccount['id']];
                }
            }
            foreach ($value as &$student) {
                $profile = $profileByRoll[(string)($student['roll'] ?? '')] ?? null;
                if (!$profile) continue;
                foreach (['name', 'email', 'phone', 'avatar'] as $field) {
                    if (array_key_exists($field, $profile)) $student[$field] = $profile[$field];
                }
            }
            unset($student);
        }
        if ($key === 'profiles' && $account['role'] !== 'admin') {
            $profiles = is_array($value) ? $value : [];
            $value = isset($profiles[$account['id']]) ? [$account['id']=>$profiles[$account['id']]] : [];
        }
        json_response(['value'=>$value]);
    }
    if ($action === 'save' && $method === 'POST') {
        $input = body_json();
        $key = (string)($input['key'] ?? '');
        $value = $input['value'] ?? null;
        if (!in_array($key, ['students','sections','profiles'], true)) json_response(['error'=>'Unknown data set.'],404);
        if ($key === 'sections' && $account['role'] !== 'admin') json_response(['error'=>'Administrator access required.'],403);
        if ($key === 'students') {
            if (!is_array($value)) json_response(['error'=>'Student records must be a list.'],400);
            if (!in_array($account['role'], ['admin','teacher','student'], true)) json_response(['error'=>'Access denied.'],403);
            if ($account['role'] === 'admin') {
                $existing = store_value('students') ?? [];
                $byId = [];
                foreach ($existing as $record) $byId[(string)($record['id'] ?? '')] = $record;
                foreach ($value as $record) {
                    $id = (string)($record['id'] ?? '');
                    if (isset($byId[$id])) {
                        foreach (['attendance', 'absences', 'lateArrivals'] as $field) {
                            if (($record[$field] ?? null) !== ($byId[$id][$field] ?? null)) {
                                json_response(['error'=>'Update attendance using the attendance editor. Attendance is calculated from absences.'],403);
                            }
                        }
                    } elseif ((float)($record['attendance'] ?? 100) !== 100.0 || (int)($record['absences'] ?? 0) !== 0 || (int)($record['lateArrivals'] ?? 0) !== 0) {
                        json_response(['error'=>'New student records start with 100% attendance and no recorded absences or late arrivals. Use the attendance editor to record changes.'],400);
                    }
                }
            }
            if ($account['role'] !== 'admin') {
                $existing = store_value('students') ?? [];
                $byId = [];
                foreach ($existing as $record) $byId[(string)($record['id']??'')] = $record;
                foreach ($value as $record) {
                    $id = (string)($record['id']??'');
                    if (!isset($byId[$id])) json_response(['error'=>'Record not found.'],403);
                    $before = $byId[$id];
                    if ($account['role'] === 'teacher') {
                        if (!in_array($before['grade']??'',($account['grades']??[]),true)) json_response(['error'=>'Record is outside your assigned sections.'],403);
                        foreach ($record as $field=>$fieldValue) { if (in_array($field,['attendance','absences','lateArrivals'],true) && ($before[$field]??null)!==$fieldValue) json_response(['error'=>'Use the attendance editor to update attendance. The percentage is calculated from absences.'],403); if (!(in_array($field,['subjectScores','requirements'],true) && !array_key_exists($field,$before)) && !in_array($field,['attendance','absences','lateArrivals'],true) && ($before[$field]??null)!==$fieldValue) json_response(['error'=>'Teachers can update attendance only.'],403); }
                    } else {
                        if (($before['roll']??'') !== ($account['studentRoll']??'')) json_response(['error'=>'This is not your student record.'],403);
                        foreach ($record as $field=>$fieldValue) if ($field !== 'requirements' && !($field === 'subjectScores' && !array_key_exists('subjectScores',$before)) && ($before[$field]??null)!==$fieldValue) json_response(['error'=>'Students can update their own requirements only.'],403);
                        $requirements = $record['requirements'] ?? [];
                        $oldRequirements = $before['requirements'] ?? [];
                        $reqOrder = ['goodMoral','form137','form138','psa','medical','clearance'];
                        $statuses = ['Submitted','Pending','Missing'];
                        foreach ($requirements as $reqKey=>$reqValue) {
                            if (!valid_requirement((string)$reqKey)) json_response(['error'=>'Unknown requirement.'],400);
                            $defaultStatus = $statuses[((int)$id + array_search($reqKey,$reqOrder,true)) % 3];
                            $oldStatus = $oldRequirements[$reqKey]['status'] ?? $defaultStatus;
                            $newStatus = $reqValue['status'] ?? $oldStatus;
                            if ($newStatus !== $oldStatus && !($oldStatus === 'Missing' && $newStatus === 'Pending')) json_response(['error'=>'That requirement cannot be changed by a student.'],403);
                        }
                    }
                }
                foreach ($value as $record) {
                    $id = (string)($record['id']??'');
                    if (!isset($byId[$id])) continue;
                    if ($account['role'] === 'teacher') {
                        // Attendance changes must use the dedicated, server-calculated attendance action.
                    } else {
                        $byId[$id]['requirements']=$record['requirements']??($byId[$id]['requirements']??[]);
                    }
                }
                $value = array_values($byId);
            }
        }
        if ($key === 'profiles') {
            $profile = $input['profile'] ?? null;
            if (!is_array($profile) || !filter_var((string)($profile['email']??''), FILTER_VALIDATE_EMAIL) || trim((string)($profile['name']??'')) === '' || trim((string)($profile['title']??'')) === '') json_response(['error'=>'Enter a valid name, title and email.'],400);

            $pdo = db();
            $name = trim((string)$profile['name']);
            $email = strtolower(trim((string)$profile['email']));
            $title = trim((string)$profile['title']);
            $phone = trim((string)($profile['phone']??''));
            $avatar = (string)($profile['avatar']??'');

            try {
                $pdo->beginTransaction();

                $duplicate = $pdo->prepare('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1');
                $duplicate->execute([$email, $account['id']]);
                if ($duplicate->fetchColumn()) {
                    $pdo->rollBack();
                    json_response(['error'=>'That email address is already used by another account.'],409);
                }

                $profiles = store_value('profiles');
                if (!is_array($profiles)) $profiles = [];
                $profiles[$account['id']] = ['name'=>$name,'title'=>$title,'email'=>$email,'phone'=>$phone,'avatar'=>$avatar];

                $update = $pdo->prepare('UPDATE users SET name=?, email=?, title=? WHERE id=?');
                $update->execute([$name, $email, $title, $account['id']]);

                // Keep the student's linked roster record in sync with their editable profile fields.
                if ($account['role'] === 'student') {
                    $students = store_value('students');
                    if (!is_array($students)) {
                        $pdo->rollBack();
                        json_response(['error'=>'The linked student roster is unavailable.'],409);
                    }
                    $matched = false;
                    foreach ($students as &$student) {
                        if (($student['roll'] ?? '') !== ($account['studentRoll'] ?? '')) continue;
                        $student['name'] = $name;
                        $student['email'] = $email;
                        $student['phone'] = $phone;
                        $student['avatar'] = $avatar;
                        $matched = true;
                        break;
                    }
                    unset($student);
                    if (!$matched) {
                        $pdo->rollBack();
                        json_response(['error'=>'The student profile could not be matched to a roster record.'],409);
                    }
                    save_value('students', $students);
                }

                save_value('profiles', $profiles);

                // Refresh this PHP session so a reload immediately shows the saved account fields.
                $_SESSION['account']['name'] = $name;
                $_SESSION['account']['email'] = $email;
                $_SESSION['account']['title'] = $title;

                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }
            json_response(['ok'=>true]);
        }
        save_value($key,$value);
        json_response(['ok'=>true]);
    }
    if ($action === 'upload' && $method === 'POST') {
        if (!in_array($account['role'],['admin','student'],true)) json_response(['error'=>'Document upload is not allowed.'],403);
        $roll=(string)($_POST['roll']??''); $requirement=(string)($_POST['requirement']??'');
        if (($account['role']==='student' && $roll !== ($account['studentRoll']??'')) || !valid_requirement($requirement)) json_response(['error'=>'You cannot submit a document for this record.'],403);
        if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) json_response(['error'=>'The document upload failed.'],400);
        $upload=$_FILES['file'];
        if ($upload['size'] > 10*1024*1024) json_response(['error'=>'Documents must be 10 MB or smaller.'],413);
        $mime=(new finfo(FILEINFO_MIME_TYPE))->file($upload['tmp_name']);
        $allowed=['application/pdf'=>'pdf','image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'];
        if (!isset($allowed[$mime])) json_response(['error'=>'Upload a PDF, JPG, PNG or WebP document.'],415);
        $directory=ensure_file_directory(); $storedName=bin2hex(random_bytes(24)).'.'.$allowed[$mime];
        if (!move_uploaded_file($upload['tmp_name'],$directory.'/'.$storedName)) json_response(['error'=>'The document could not be stored.'],500);
        $files=store_value('requirement_files')??[]; $key=file_key($roll,$requirement); $old=$files[$key]['stored']??null;
        $files[$key]=['stored'=>$storedName,'name'=>basename((string)$upload['name']),'type'=>$mime]; save_value('requirement_files',$files);
        if ($old) @unlink(file_path($old));
        json_response(['ok'=>true]);
    }
    if ($action === 'file' && $method === 'GET') {
        $roll=(string)($_GET['roll']??''); $requirement=(string)($_GET['requirement']??'');
        if (!valid_requirement($requirement) || !account_can_access_roll($account,$roll)) json_response(['error'=>'You cannot access this document.'],403);
        $files=store_value('requirement_files')??[]; $entry=$files[file_key($roll,$requirement)]??null;
        if (!$entry || !is_file(file_path($entry['stored']??''))) json_response(['error'=>'The uploaded document is no longer available.'],404);
        header('Content-Type: '.$entry['type']); header('Content-Length: '.filesize(file_path($entry['stored']))); header('X-File-Name: '.rawurlencode($entry['name'])); header('Cache-Control: no-store');
        readfile(file_path($entry['stored'])); exit;
    }
    if ($action === 'delete_file' && $method === 'POST') {
        if (!in_array($account['role'],['admin','student'],true)) json_response(['error'=>'Access denied.'],403);
        $input=body_json(); $roll=(string)($input['roll']??''); $requirement=(string)($input['requirement']??'');
        if (!valid_requirement($requirement)) json_response(['error'=>'Unknown requirement.'],400);
        if ($account['role']==='student' && $roll !== ($account['studentRoll']??'')) json_response(['error'=>'This is not your student record.'],403);
        $files=store_value('requirement_files')??[]; $key=file_key($roll,$requirement); $entry=$files[$key]??null;
        unset($files[$key]); save_value('requirement_files',$files);
        if ($entry) @unlink(file_path($entry['stored']??''));
        json_response(['ok'=>true]);
    }
    json_response(['error'=>'Unknown action.'],404);
} catch (Throwable $e) {
    error_log($e->__toString());
    json_response(['error'=>'The server could not complete the request. Check the PHP error log.'],500);
}