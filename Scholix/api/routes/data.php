<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/../helpers.php';

function handle_data_route(string $action, string $method, array $account): void {
    if ($action === 'assign_students' && $method === 'POST') {
        if (($account['role'] ?? '') !== 'admin') json_response(['error'=>'Administrator access required.'],403);
        $input = body_json();
        $sectionCode = strtoupper(trim((string)($input['sectionCode'] ?? '')));
        $studentIds = array_values(array_unique(array_map('strval', is_array($input['studentIds'] ?? null) ? $input['studentIds'] : [])));
        if ($sectionCode === '' || !$studentIds) json_response(['error'=>'Choose a section and at least one student.'],400);
        $sections = store_value('sections');
        $students = store_value('students');
        if (!is_array($sections) || !is_array($students)) json_response(['error'=>'Section or student data is unavailable.'],409);
        $section = null;
        foreach ($sections as $candidate) if (strtoupper((string)($candidate['code'] ?? '')) === $sectionCode) { $section = $candidate; break; }
        if (!$section) json_response(['error'=>'The selected section no longer exists. Refresh the page and try again.'],404);
        $selected = [];
        foreach ($students as $index => $student) if (in_array((string)($student['id'] ?? ''), $studentIds, true)) {
            if (($student['grade'] ?? '') !== ($section['grade'] ?? '')) json_response(['error'=>'A selected student is not in the section grade.'],409);
            if (preg_match('/^(\d+[A-Z])/i', (string)($student['roll'] ?? ''), $match) && strtoupper($match[1]) === $sectionCode) json_response(['error'=>'A selected student is already assigned to this section.'],409);
            $selected[] = $index;
        }
        if (count($selected) !== count($studentIds)) json_response(['error'=>'One or more selected students could not be found. Refresh and try again.'],404);
        $reserved = [];
        foreach ($students as $index => $student) if (!in_array($index, $selected, true)) $reserved[strtolower((string)($student['roll'] ?? ''))] = true;
        $changes = [];
        foreach ($selected as $index) {
            $oldRoll = (string)($students[$index]['roll'] ?? '');
            $suffix = preg_match('/-(\d+)$/', $oldRoll, $m) ? (int)$m[1] : 1;
            do { $newRoll = $sectionCode . '-' . str_pad((string)$suffix++, 3, '0', STR_PAD_LEFT); } while (isset($reserved[strtolower($newRoll)]));
            $reserved[strtolower($newRoll)] = true;
            $students[$index]['roll'] = $newRoll;
            $students[$index]['sectionAssignedAt'] = date('c');
            $changes[] = [$index, $oldRoll, $newRoll];
        }
        $pdo = db();
        try {
            $pdo->beginTransaction();
            save_value('students', $students);
            $sync = $pdo->prepare("UPDATE users SET student_roll=? WHERE role='student' AND student_roll=?");
            foreach ($changes as [$index, $oldRoll, $newRoll]) $sync->execute([$newRoll, $oldRoll]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            error_log('Student section assignment failed: ' . $e->getMessage());
            json_response(['error'=>'Database rejected the section assignment. Check that student roll numbers are unique and try again.'],500);
        }
        foreach ($changes as [$index]) {
            $student = $students[$index];
            $name = (string)($student['name'] ?? 'Student');
            notify_student_and_adviser($student, (string)$account['id'], 'Student added to roster', 'Administrator ' . (string)$account['name'] . ' assigned you to ' . $sectionCode . '.', 'Administrator ' . (string)$account['name'] . ' added ' . $name . ' to your roster.', 'roster', 'section-roster:' . $sectionCode . ':' . (string)$student['id'] . ':' . (string)$student['roll'], false, 'Student added to your roster');
        }
        json_response(['ok'=>true,'assigned'=>count($changes)]);
    }    if ($action === 'get' && $method === 'GET') {
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
            if ($account['role'] === 'teacher') {
                $assignedSections = store_value('sections');
                if (!is_array($assignedSections)) $assignedSections = [];
                $assignedSections = array_values(array_filter($assignedSections, fn($section) => (string)($section['adviserId'] ?? '') === (string)$account['id']));
                $value = array_values(array_filter($value, function ($student) use ($assignedSections) {
                    $roll = (string)($student['roll'] ?? '');
                    if (!preg_match('/^(\d+[A-Z])/i', $roll, $match)) return false;
                    $code = strtoupper($match[1]);
                    foreach ($assignedSections as $section) if (($section['code'] ?? '') === $code && ($section['grade'] ?? '') === ($student['grade'] ?? '')) return true;
                    return false;
                }));
            }
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
                if (!array_key_exists('guardianPhone', $student)) {
                    $legacyPhone = trim((string)($student['phone'] ?? ''));
                    $profilePhone = trim((string)($profile['phone'] ?? ''));
                    $student['guardianPhone'] = $legacyPhone !== '' && $legacyPhone !== $profilePhone ? $legacyPhone : '';
                }
                if (!$profile) continue;
                foreach (['name', 'email', 'avatar'] as $field) {
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
        $pendingStudentNotifications = [];
        $pendingFeeNotifications = [];
        $pendingGradeNotifications = [];
        $pendingAccountNotifications = [];
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
                    $oldFee = $byId[$id] ?? [];
                    $feeChanged = !isset($byId[$id]) || ($record['feeStatus'] ?? null) !== ($oldFee['feeStatus'] ?? null) || (float)($record['due'] ?? 0) !== (float)($oldFee['due'] ?? 0);
                    if ($feeChanged) {
                        $feeStatus = (string)($record['feeStatus'] ?? '');
                        $feeDue = $record['due'] ?? 0;
                        if (!in_array($feeStatus, school_config()['feeStatuses'] ?? [], true) || !is_numeric($feeDue) || (float)$feeDue < 0 || floor((float)$feeDue) !== (float)$feeDue) json_response(['error'=>'Choose a valid fee status and enter a non-negative whole-number balance.'],400);
                        if ($feeStatus === 'Paid' && (float)$feeDue !== 0.0) json_response(['error'=>'A Paid fee record must have a ₱0 outstanding balance.'],400);
                    }                }
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
                        $reqOrder = array_column(school_requirements(), 'key');
                        $statuses = school_config()['requirementStatuses'] ?? [];
                        foreach ($requirements as $reqKey=>$reqValue) {
                            if (!valid_requirement((string)$reqKey)) json_response(['error'=>'Unknown requirement.'],400);
                            $defaultStatus = $statuses[((int)$id + array_search($reqKey,$reqOrder,true)) % max(1, count($statuses))];
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
            $profiles = store_value('profiles');
            if (!is_array($profiles)) $profiles = [];
            $students = null;
            $existingProfile = $profiles[$account['id']] ?? [];
            $profileChanged = $name !== (string)($account['name'] ?? '') || $email !== strtolower((string)($account['email'] ?? '')) || $title !== (string)($account['title'] ?? '') || $phone !== (string)($existingProfile['phone'] ?? '') || $avatar !== (string)($existingProfile['avatar'] ?? '');
            $profileChangedLabels = [];
            if ($name !== (string)($account['name'] ?? '')) $profileChangedLabels[] = 'display name';
            if ($email !== strtolower((string)($account['email'] ?? ''))) $profileChangedLabels[] = 'email';
            if ($title !== (string)($account['title'] ?? '')) $profileChangedLabels[] = 'role title';
            if ($phone !== (string)($existingProfile['phone'] ?? '')) $profileChangedLabels[] = 'contact number';
            if ($avatar !== (string)($existingProfile['avatar'] ?? '')) $profileChangedLabels[] = 'profile picture';

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
            if ($profileChanged && $account['role'] === 'student' && is_array($students ?? null)) {
                foreach ($students as $updatedStudent) {
                    if (($updatedStudent['roll'] ?? '') !== ($account['studentRoll'] ?? '')) continue;
                    notify_student_change($updatedStudent, (string)$account['id'], 'Student profile updated', (string)$updatedStudent['name'] . ' updated their profile (' . implode(', ', $profileChangedLabels) . '). The changes are now visible in the school roster.', 'roster', true, 'profile:' . (string)$updatedStudent['roll'] . ':' . hash('sha256', (string)json_encode([$name, $email, $title, $phone, $avatar])));
                    break;
                }
            }
            json_response(['ok'=>true]);
        }
        if ($key === 'students' && is_array($value)) {
            $actorName = trim((string)($account['name'] ?? 'School staff'));
            $actorRole = ($account['role'] ?? '') === 'admin' ? 'Administrator' : 'Teacher';
            $oldStudents = store_value('students');
            if (!is_array($oldStudents)) $oldStudents = [];
            $oldById = [];
            foreach ($oldStudents as $oldStudent) $oldById[(string)($oldStudent['id'] ?? '')] = $oldStudent;
            $requirementLabels = [];
            foreach (school_requirements() as $requirement) $requirementLabels[(string)($requirement['key'] ?? '')] = (string)($requirement['label'] ?? 'document');
            $newIds = [];
            foreach ($value as $newStudent) {
                $studentId = (string)($newStudent['id'] ?? '');
                $newIds[$studentId] = true;
                $oldStudent = $oldById[$studentId] ?? [];
                if ($oldStudent === $newStudent) continue;
                $oldRequirements = $oldStudent['requirements'] ?? [];
                $newRequirements = $newStudent['requirements'] ?? [];
                foreach ($requirementLabels as $reqKey=>$reqLabel) {
                    $before = $oldRequirements[$reqKey] ?? [];
                    $after = $newRequirements[$reqKey] ?? [];
                    $oldStatus = (string)($before['status'] ?? 'Missing');
                    $newStatus = (string)($after['status'] ?? 'Missing');
                    if ($oldStatus === $newStatus && ($before['note'] ?? '') === ($after['note'] ?? '')) continue;
                    if ($account['role'] === 'student') {
                        if ($newStatus === 'Pending' && $oldStatus !== 'Pending') $pendingStudentNotifications[] = [$newStudent, 'Document submitted', 'You submitted ' . $reqLabel . ' for office review.', 'requirements', true, 'doc:' . $studentId . ':' . $reqKey . ':' . $oldStatus . ':Pending', $newStudent['name'] . ' submitted ' . $reqLabel . ' for office review.', true];
                    } else {
                        $note = trim((string)($after['note'] ?? ''));
                        $who = $actorRole . ' ' . $actorName;
                        $title = 'Requirement updated';
                        $studentMessage = '';
                        $staffMessage = '';
                        if ($oldStatus === $newStatus) {
                            // Admin note edits notify the student, but do not send a note alert to the adviser.
                            if ($account['role'] === 'admin') {
                                $studentMessage = $who . ' updated the office note for your ' . $reqLabel . '.' . ($note !== '' ? ' ' . $note : '');
                                $staffMessage = '';
                                $title = 'Requirement note updated';
                                $noteEvent = 'doc-note:' . $studentId . ':' . $reqKey . ':' . hash('sha256', $note);
                                $pendingStudentNotifications[] = [$newStudent, $title, $studentMessage, 'requirements', false, $noteEvent, $staffMessage, false, false];
                            }
                            continue;
                        }
                        if ($oldStatus === 'Pending' && $newStatus === 'Missing') {
                            $studentMessage = $who . ' rejected your ' . $reqLabel . '.' . ($note !== '' ? ' ' . $note : ' Please upload a corrected document.');
                            $staffMessage = $who . ' rejected ' . $newStudent['name'] . "'s " . $reqLabel . '.';
                            $title = 'Document rejected';
                        } elseif ($oldStatus === 'Pending' && $newStatus === 'Submitted') {
                            $studentMessage = $who . ' accepted your ' . $reqLabel . '.';
                            $staffMessage = $who . ' accepted ' . $newStudent['name'] . "'s " . $reqLabel . '.';
                            $title = 'Document accepted';
                        } elseif ($oldStatus !== $newStatus) {
                            $studentMessage = $who . ' changed your ' . $reqLabel . ' status to ' . $newStatus . '.' . ($note !== '' ? ' ' . $note : '');
                            $staffMessage = $who . ' changed ' . $newStudent['name'] . "'s " . $reqLabel . ' status to ' . $newStatus . '.';
                            $title = 'Requirement updated';
                        }
                        $pendingStudentNotifications[] = [$newStudent, $title, $studentMessage, 'requirements', false, 'doc:' . $studentId . ':' . $reqKey . ':' . $oldStatus . ':' . $newStatus, $staffMessage, false];
                    }
                }
                if ($account['role'] === 'admin' && isset($oldStudent['id'])) {
                    $oldFeeStatus = (string)($oldStudent['feeStatus'] ?? 'Unpaid');
                    $newFeeStatus = (string)($newStudent['feeStatus'] ?? $oldFeeStatus);
                    $oldDue = max(0, (float)($oldStudent['due'] ?? 0));
                    $newDue = max(0, (float)($newStudent['due'] ?? 0));
                    if ($oldFeeStatus !== $newFeeStatus || $oldDue !== $newDue) {
                        $actor = 'Administrator ' . $actorName;
                        $amount = '₱' . number_format($newDue, 0, '.', ',');
                        $studentName = (string)($newStudent['name'] ?? 'the student');
                        if ($newFeeStatus === 'Paid' && $oldFeeStatus !== 'Paid') {
                            $feeTitle = 'Fees paid';
                            $studentFeeMessage = $actor . ' marked your school fees as paid. Your balance is fully settled.';
                            $staffFeeMessage = $actor . ' marked ' . $studentName . "'s school fees as paid. Balance: ₱0.";
                        } elseif ($newFeeStatus === 'Paid') {
                            $feeTitle = 'Fee balance updated';
                            $studentFeeMessage = $actor . ' updated your fee record. Your status remains Paid and your outstanding balance is ₱0.';
                            $staffFeeMessage = $actor . ' updated ' . $studentName . "'s fee record. Status remains Paid; balance: ₱0.";
                        } elseif ($oldFeeStatus !== $newFeeStatus) {
                            $feeTitle = 'Fee status updated';
                            $studentFeeMessage = $actor . ' changed your fee status to ' . $newFeeStatus . '. Your outstanding balance is ' . $amount . '.';
                            $staffFeeMessage = $actor . ' changed ' . $studentName . "'s fee status to " . $newFeeStatus . '. Outstanding balance: ' . $amount . '.';
                        } else {
                            $feeTitle = 'Fee balance updated';
                            $studentFeeMessage = $actor . ' updated your outstanding fee balance to ' . $amount . '. Your fee status remains ' . $newFeeStatus . '.';
                            $staffFeeMessage = $actor . ' updated ' . $studentName . "'s outstanding fee balance to " . $amount . '. Fee status remains ' . $newFeeStatus . '.';
                        }
                        $feeEvent = 'fee:' . $studentId . ':' . $newFeeStatus . ':' . number_format($newDue, 2, '.', '');
                        $pendingFeeNotifications[] = [$newStudent, $feeTitle, $studentFeeMessage, $staffFeeMessage, $feeEvent];
                    }
                }
                if (isset($oldStudent['id']) && $account['role'] !== 'student'
                    && ($oldStudent['subjectScores'] ?? null) !== ($newStudent['subjectScores'] ?? null)) {
                    $studentName = (string)($newStudent['name'] ?? 'the student');
                    $gradeEvent = 'grade-report:' . $studentId . ':' . hash('sha256', (string)json_encode($newStudent['subjectScores'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                    $studentMessage = 'Your grade report got updated by ' . $actorRole . ' ' . $actorName . '.';
                    $staffMessage = $actorRole . ' ' . $actorName . ' updated ' . $studentName . "'s grade report.";
                    $pendingGradeNotifications[] = [$newStudent, 'Grade report updated', $studentMessage, $staffMessage, $gradeEvent];
                }
                $oldNonRequirement = $oldStudent;
                $newNonRequirement = $newStudent;
                unset($oldNonRequirement['requirements'], $newNonRequirement['requirements'], $oldNonRequirement['attendance'], $newNonRequirement['attendance'], $oldNonRequirement['absences'], $newNonRequirement['absences'], $oldNonRequirement['lateArrivals'], $newNonRequirement['lateArrivals'], $oldNonRequirement['subjectScores'], $newNonRequirement['subjectScores'], $oldNonRequirement['feeStatus'], $newNonRequirement['feeStatus'], $oldNonRequirement['due'], $newNonRequirement['due']);
                if ($oldNonRequirement !== $newNonRequirement && $account['role'] === 'admin') {
                    if (isset($oldStudent['id'])) {
                        $changedFields = [];
                        $fieldLabels = ['name'=>'name','email'=>'email','phone'=>'guardian contact','guardianPhone'=>'guardian contact','grade'=>'grade','roll'=>'roll number','guardian'=>'guardian details','guardianName'=>'guardian details'];
                        foreach ($fieldLabels as $field => $label) if (($oldStudent[$field] ?? null) !== ($newStudent[$field] ?? null)) $changedFields[$label] = true;
                        $detail = $changedFields ? ' Updated: ' . implode(', ', array_keys($changedFields)) . '.' : '';
                        $recordEvent = 'record:' . $studentId . ':' . hash('sha256', (string)json_encode($newNonRequirement, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                        $studentMessage = 'Administrator ' . $actorName . ' updated your student record.' . $detail;
                        $staffMessage = 'Administrator ' . $actorName . ' updated ' . (string)($newStudent['name'] ?? 'a student') . "'s student record." . $detail;
                        if (array_keys($changedFields) !== ['roll number']) {
                            $pendingStudentNotifications[] = [$newStudent, 'Student record updated', $studentMessage, 'roster', false, $recordEvent, $staffMessage, 'record'];
                        }
                    } else {
                        $recordEvent = 'roster-added:' . $studentId;
                        $studentMessage = 'Administrator ' . $actorName . ' added your record to the student roster.';
                        $staffMessage = 'Administrator ' . $actorName . ' added ' . (string)($newStudent['name'] ?? 'a student') . ' to your roster.';
                        $pendingStudentNotifications[] = [$newStudent, 'Student added to roster', $studentMessage, 'roster', false, $recordEvent, $staffMessage, 'record'];
                    }
                }
            }
            if ($account['role'] === 'admin') foreach ($oldById as $oldId => $removedStudent) {
                if (!isset($newIds[$oldId])) {
                    $recordEvent = 'roster-removed:' . $oldId;
                    $studentMessage = 'Administrator ' . $actorName . ' removed your record from the active student roster. Contact the school office if this was unexpected.';
                    $staffMessage = 'Administrator ' . $actorName . ' removed ' . (string)($removedStudent['name'] ?? 'a student') . ' from the active student roster.';
                    $pendingStudentNotifications[] = [$removedStudent, 'Student record removed', $studentMessage, 'overview', false, $recordEvent, $staffMessage, 'record'];
                }
            }
        }
        if ($key === 'sections' && $account['role'] === 'admin' && is_array($value)) {
            $oldSections = store_value('sections');
            if (!is_array($oldSections)) $oldSections = [];
            $oldByCode = [];
            foreach ($oldSections as $section) $oldByCode[(string)($section['code'] ?? '') . ':' . (string)($section['grade'] ?? '')] = $section;
            $newSectionKeys = [];
            foreach ($value as $section) $newSectionKeys[(string)($section['code'] ?? '') . ':' . (string)($section['grade'] ?? '')] = true;
            foreach ($value as $section) {
                $sectionKey = (string)($section['code'] ?? '') . ':' . (string)($section['grade'] ?? '');
                $before = $oldByCode[$sectionKey] ?? [];
                if (($before['adviserId'] ?? '') === ($section['adviserId'] ?? '')) continue;
                $recipientIds = array_filter([(string)($before['adviserId'] ?? ''), (string)($section['adviserId'] ?? '')]);
                $pendingAccountNotifications[] = [$recipientIds, 'Section assignment changed', 'Administrator ' . (string)($account['name'] ?? 'School staff') . ' updated the adviser assignment for ' . ($section['grade'] ?? '') . ' ' . ($section['code'] ?? '') . '.', 'sections', 'section:' . $sectionKey . ':' . (string)($section['adviserId'] ?? '')];
            }
            foreach ($oldByCode as $oldKey=>$oldSection) {
                if (!isset($newSectionKeys[$oldKey]) && !empty($oldSection['adviserId'])) $pendingAccountNotifications[] = [[(string)$oldSection['adviserId']], 'Section removed', 'Administrator ' . (string)($account['name'] ?? 'School staff') . ' removed ' . ($oldSection['grade'] ?? '') . ' ' . ($oldSection['code'] ?? '') . ' from your assignments.', 'sections', 'section-removed:' . $oldKey];
            }
        }
        save_value($key,$value);
        if ($key === 'students' && $account['role'] === 'admin' && is_array($value)) {
            // Keep student logins linked to their existing record when an administrator changes its roll prefix.
            $syncStudentRoll = db()->prepare("UPDATE users SET student_roll=? WHERE role='student' AND student_roll=?");
            foreach ($value as $studentRecord) {
                $studentId = (string)($studentRecord['id'] ?? '');
                $oldRoll = (string)($oldById[$studentId]['roll'] ?? '');
                $newRoll = (string)($studentRecord['roll'] ?? '');
                if ($oldRoll !== '' && $newRoll !== '' && $oldRoll !== $newRoll) {
                    $syncStudentRoll->execute([$newRoll, $oldRoll]);
                }
            }
        }
        foreach ($pendingStudentNotifications as $pendingNotice) {
            if (($pendingNotice[7] ?? '') === 'record') notify_student_and_adviser($pendingNotice[0], (string)$account['id'], $pendingNotice[1], $pendingNotice[2], $pendingNotice[6], $pendingNotice[3], $pendingNotice[5] ?? '', false, $pendingNotice[1] === 'Student added to roster' ? 'Student added to your roster' : null);
            elseif (isset($pendingNotice[6])) notify_requirement_change($pendingNotice[0], (string)$account['id'], $pendingNotice[1], $pendingNotice[2], $pendingNotice[6], $pendingNotice[5] ?? '', $pendingNotice[7] ?? false, $pendingNotice[8] ?? true);
            else notify_student_change($pendingNotice[0], (string)$account['id'], $pendingNotice[1], $pendingNotice[2], $pendingNotice[3], $pendingNotice[4], $pendingNotice[5] ?? '');
        }
        foreach ($pendingFeeNotifications as $feeNotice) notify_student_and_adviser($feeNotice[0], (string)$account['id'], $feeNotice[1], $feeNotice[2], $feeNotice[3], 'fees', $feeNotice[4]);
        foreach ($pendingGradeNotifications as $gradeNotice) notify_student_and_adviser($gradeNotice[0], (string)$account['id'], $gradeNotice[1], $gradeNotice[2], $gradeNotice[3], 'grades', $gradeNotice[4]);
        foreach ($pendingAccountNotifications as $pendingNotice) push_notification($pendingNotice[0], (string)$account['id'], $pendingNotice[1], $pendingNotice[2], $pendingNotice[3], $pendingNotice[4] ?? '');
        json_response(['ok'=>true]);
    }
}
