$(document).ready(function () {
    const userData = JSON.parse(localStorage.getItem('dealchat_users'));
    if (!userData || !userData.isLoggedIn) {
        alert('로그인 후 이용해주세요.');
        location.href = './signin.html';
        return;
    }
    const userId = userData.id;
    const userName = userData.name;

    $('#userName').text(userName);
    $('#userName2').text(userName);

    // User Menu Toggle
    $('#user-menu-trigger').on('click', function (e) {
        e.stopPropagation();
        $('#user-menu-dropdown').fadeToggle(150);
    });

    $(document).on('click', function () {
        $('#user-menu-dropdown').fadeOut(150);
    });

    $('#btn-signout').on('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (confirm('로그아웃 하시겠습니까?')) {
            localStorage.removeItem('dealchat_users');
            location.href = '../index.html';
        }
    });

    $('#user-menu-dropdown').on('click', function (e) {
        e.stopPropagation();
    });
});