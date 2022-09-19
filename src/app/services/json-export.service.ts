import { Injectable } from '@angular/core';


@Injectable({
  providedIn: 'root'
})
export class JsonExportService {

  constructor(
  ) { }

  downloadFile(myObj: any){
    const jsonStr = JSON.stringify(myObj, null, "\t");
    this.toFile(jsonStr, "myFile.json", "application/json");
    console.log("JSON export complete!")
    console.log(jsonStr)
  }

  toFile(str: string, fileName: string = "file.txt", mimetype: string = "text/plain"): void{
    this.saveFile(str, fileName, mimetype);
    return;
  }

  saveFile = (function () {
    let a = document.createElement("a");
    document.body.appendChild(a);
    return function (data: any, fileName: string, mimetype: string) {
        var blob = new Blob([data], {type: mimetype}),
            url = window.URL.createObjectURL(blob);
        a.href = url;
        a.download = fileName;
        a.click();
        window.URL.revokeObjectURL(url);
        return url;
    };
  }());
}
