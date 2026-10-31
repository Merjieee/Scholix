<?php
declare(strict_types=1);

$projectConfig = dirname(__DIR__, 2) . '/config.php';
if (!is_file($projectConfig)) $projectConfig = dirname(__DIR__, 3) . '/config.php';
require_once $projectConfig;
require_once dirname(__DIR__) . '/helpers.php';

function handle_documents_route(string $action, string $method, array $account): void {
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
        if ($account['role'] === 'admin') {
            $students = store_value('students');
            if (is_array($students)) foreach ($students as $student) {
                if ((string)($student['roll'] ?? '') !== $roll) continue;
                $requirementLabels = ['goodMoral'=>'Good moral certificate','form137'=>'Form 137','form138'=>'Form 138','psa'=>'PSA birth certificate','medical'=>'Medical certificate','clearance'=>'Clearance'];
                $label = $requirementLabels[$requirement] ?? 'document';
                $actorRole = 'Administrator';
                $studentMessage = $actorRole . ' ' . (string)($account['name'] ?? 'School staff') . ' uploaded a file for your ' . $label . '.';
                $staffMessage = $actorRole . ' ' . (string)($account['name'] ?? 'School staff') . ' uploaded a file for ' . (string)($student['name'] ?? 'a student') . "'s " . $label . '.';
                notify_requirement_change($student, (string)$account['id'], 'Document file updated', $studentMessage, $staffMessage, 'file:' . $roll . ':' . $requirement . ':staff-upload');
                break;
            }
        }
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
        if ($entry) {
            @unlink(file_path($entry['stored'] ?? ''));
            $students = store_value('students');
            if (is_array($students)) foreach ($students as $student) {
                if ((string)($student['roll'] ?? '') !== $roll) continue;
                $requirementLabels = ['goodMoral'=>'Good moral certificate','form137'=>'Form 137','form138'=>'Form 138','psa'=>'PSA birth certificate','medical'=>'Medical certificate','clearance'=>'Clearance'];
                $label = $requirementLabels[$requirement] ?? 'document';
                $actorRole = ($account['role'] ?? '') === 'admin' ? 'Administrator' : 'Student';
                $actorName = (string)($account['name'] ?? 'School account');
                if ($account['role'] === 'admin') {
                    $studentMessage = 'Administrator ' . $actorName . ' removed the file for your ' . $label . '. Please upload a corrected document if needed.';
                    $staffMessage = 'Administrator ' . $actorName . ' removed the file for ' . (string)($student['name'] ?? 'a student') . "'s " . $label . '.';
                } else {
                    $studentMessage = 'You removed the file for your ' . $label . '.';
                    $staffMessage = $actorName . ' removed the file for ' . $label . '.';
                }
                notify_requirement_change($student, (string)$account['id'], 'Document file removed', $studentMessage, $staffMessage, 'file:' . $roll . ':' . $requirement . ':removed');
                break;
            }
        }
        json_response(['ok'=>true]);
    }
}
