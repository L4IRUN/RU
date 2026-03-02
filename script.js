async function uploadToGist(isAuto = false) {
    const token = localStorage.getItem('github_token');
    const gistId = localStorage.getItem('gist_id');
    
    if (!token || !gistId) {
        if (!isAuto) openCloudAlert();
        return;
    }

    const data = {
        notes: notes,
        bookmarks: bookmarks,
        category_order: localStorage.getItem('my_category_order'),
        app_title: localStorage.getItem('my_app_title')
    };

    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                files: {
                    'my_notes.json': {
                        content: JSON.stringify(data)
                    }
                }
            })
        });
        if (response.ok) {
            closeSettingsMenu();
            if (!isAuto) showCloudToast('備份成功'); 
        } else {
            if (!isAuto) alert('上傳失敗，請檢查 Token 權限');
        }
    } catch (error) {
        if (!isAuto) alert('網路連線錯誤');
    }
}

async function downloadFromGist(isAuto = false) {
    const token = localStorage.getItem('github_token');
    const gistId = localStorage.getItem('gist_id');
    
    if (!token || !gistId) {
        if (!isAuto) openCloudAlert();
        return;
    }

    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`伺服器連線異常 (狀態碼: ${response.status})`);
        }

        const gist = await response.json();
        
        if (!gist.files || !gist.files['my_notes.json']) {
            throw new Error('雲端沒有找到 my_notes.json 檔案');
        }

        const rawUrl = gist.files['my_notes.json'].raw_url;
        const fileResponse = await fetch(`${rawUrl}?t=${Date.now()}`);
        
        if (!fileResponse.ok) {
            throw new Error('無法讀取雲端真實檔案內容');
        }

        const importedData = await fileResponse.json();
        
        notes = importedData.notes || {};
        bookmarks = importedData.bookmarks || {};
        
        if (importedData.category_order) {
            localStorage.setItem('my_category_order', importedData.category_order);
        }
        if (importedData.app_title) {
            localStorage.setItem('my_app_title', importedData.app_title);
            document.getElementById('app-logo-text').innerText = importedData.app_title;
            document.title = importedData.app_title;
        }

        localStorage.setItem('my_life_notes', JSON.stringify(notes));
        localStorage.setItem('my_bookmarks', JSON.stringify(bookmarks));
        
        renderSidebar();
        if (currentView === 'notes') {
            renderNotes();
        } else {
            renderBookmarks();
        }
        
        closeSettingsMenu();
        if (!isAuto) showCloudToast('下載成功'); 
        
    } catch (error) {
        console.error(error);
        if (!isAuto) alert(`下載失敗！\n錯誤資訊：${error.message}\n請檢查 Gist ID 是否正確，或確認網路狀態。`);
    }
}
