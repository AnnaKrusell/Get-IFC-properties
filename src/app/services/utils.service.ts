import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class UtilsService {

  constructor() { }

  uriToGlobalId(URI: string): string{
    const n = URI.lastIndexOf('/');
    return decodeURIComponent(URI.substring(n + 1));
  }


  buildValueString(items: string[]): string{
    let values: string = "";
    items.forEach(item => {
      values += this.stringHandler(item) + " ";
    })
    return values;
  }

  buildValueStringMulti(items: any[], appendIndex: boolean = false): string{
    const keys: string[] = Object.keys(items[0]);

    let values: string = "VALUES ( ";
    keys.forEach(key => values+= `?${key} `);
    if(appendIndex) values+= "?index ";
    values+= ") {\n";

    items.forEach((item, i) => {
        values+= "\t( ";
        keys.forEach((key: any) => values+= this.stringHandler(item[key]) + " ");
        if(appendIndex) values+= i + " ";
        values+= ")\n"
    })

    values+= "}";

    return values;
  }

  stringHandler(item: string){

    if(item.startsWith("http")) return `<${item}>`;
    if(typeof item == "string" && !item.match(/^\d+\.\d+$/)) return `"""${item}"""`;
    return item;

  }
  
}


  