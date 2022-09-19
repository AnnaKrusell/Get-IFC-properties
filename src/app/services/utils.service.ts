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
}


  