<?php require dirname(__DIR__) . '/config.php'; if (!current_account()) { header('Location: login.php'); exit; } require __DIR__ . '/dashboard.html';
