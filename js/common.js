function popup_location_close(url, val){
	location.href=url; 
}


function file_download(link) {

	//if (!confirm("첨부파일을 다운 받으시겠습니까?")) {
	//		return false;
	//} else {
			document.location.href = link;
	//}

}

function file_download_only(link) {
	document.location.href = link;
}

function fnc_file_download_all(link1, link2, link3){

	if (!confirm("첨부파일을 다운 받으시겠습니까?")) {
			return false;
	} else {
			if(link1 != ''){
				setTimeout(function() {
					file_download_only(link1);
				}, 1000);
			}
			if(link2 != ''){
				setTimeout(function() {
					file_download_only(link2);
				}, 2000);
			}
			if(link3 != ''){
				setTimeout(function() {
					file_download_only(link3);
				}, 3000);
			}
	}

}
 

