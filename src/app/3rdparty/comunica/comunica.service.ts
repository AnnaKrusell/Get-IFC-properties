import { Injectable } from '@angular/core';
import * as N3 from 'n3';
import { BehaviorSubject, from, map, mergeMap, Observable, switchMap, tap } from 'rxjs';
import { QueryResult, ResponseType, Serialization, Source, SourceType, UpdateResult } from './models';

declare let Comunica: any;

@Injectable({ providedIn: 'root' })
export class ComunicaService {

  private sources: Source[] = [];
  private sources$: BehaviorSubject<Source[]> = new BehaviorSubject<Source[]>([]);

  private queryResult: QueryResult = new QueryResult();
  private queryResult$: BehaviorSubject<QueryResult> = new BehaviorSubject<QueryResult>(new QueryResult());

  private idx: number = 0;

  constructor() { }

  public getQueryResult(): Observable<QueryResult>{
    return this.queryResult$.asObservable();
  }

  public addSource(source: Source){
    if(!source.id){
      source.id = `data-source-${this.idx}`;
      this.idx++;
    }

    if(!this.idIsUnique(source.id)){
      const msg = `A data source with id ${source.id} already exists!`;
      console.error(msg);
      throw new Error(msg);
    }

    this.sources.push(source);
    this.sources$.next(this.sources);
  }

  public renameSource(existingId: string, newId: string){

    if(!this.idIsUnique(newId)){
      const msg = `A data source with id ${newId} already exists!`;
      console.error(msg);
      throw new Error(msg);
    }

    this.sources = this.sources.map(source => {
      if(source.id == existingId){
        source.id = newId;
      }
      return source;
    })
    this.sources$.next(this.sources);
  }

  makePrimary(source: Source){
    this.sources = this.sources.map(s => {
      s.primary = false;
      if(s.id == source.id) s.primary = true;
      return s;
    });
    this.sources$.next(this.sources);
  }

  public removeSource(id: string): void{
    let source = this.sources.find(source => source.id == id);

    // Remove data to save memory
    if(source?.type == SourceType.RDFJS){
      source.value = null;
      // store.deleteGraph();
      // console.log(store.size);
    }

    this.sources = this.sources.filter(source => source.id != id);
    this.sources$.next(this.sources);
  }

  public getSources(): Observable<Source[]>{
    return this.sources$.asObservable();
  }

  public selectQuery(query: string, extensionFunctions: object = {}, responseType: ResponseType = ResponseType.ACCUMULATED): Observable<any> {

    // Prepare query result
    this.queryResult = new QueryResult();

    // Set queryRunning
    this.queryResult.running = true;
    this.queryResult.type = "SELECT";
    this.updateResultState();

    const engine = new Comunica.QueryEngine();
    const sources = this.getActiveSources();

    return from(engine.query(query, { sources, extensionFunctions })).pipe(
      switchMap(async (result: any) => {
        const { data } = await engine.resultToString(result,
          'application/sparql-results+json');
        return data;
      }),
      mergeMap((bindingStream: any) => {
        return this.streamToJSONObservable(bindingStream, responseType);
      })
    );

  }

  public async askQuery(query: string, extensionFunctions: object = {}): Promise<any> {

    const engine = new Comunica.QueryEngine();
    const sources = this.getActiveSources();

    const result = await engine.queryBoolean(query, { sources, extensionFunctions });
    return result;

  }

  public async constructQuery(query: string, extensionFunctions: object = {}, serialization: Serialization = Serialization["JSON-LD"]): Promise<any> {

    const engine = new Comunica.QueryEngine();
    const sources = this.getActiveSources();

    const result = await engine.query(query, { sources, extensionFunctions });

    const { data } = await engine.resultToString(result, serialization);

    const str = await this.streamToString(data);

    if(serialization == Serialization["JSON-LD"]){
      return JSON.parse(str);
    }

    return str;

  }

  public async updateQuery(query: string, extensionFunctions: object = {}): Promise<UpdateResult>{

    let res = new UpdateResult();
    
    const engine = new Comunica.QueryEngine();
    const store: any = this.getPrimarySource();

    const sizeBefore = store.size;

    await engine.queryVoid(query, { sources: [store], extensionFunctions });

    const sizeAfter = store.size;
    if(sizeAfter>sizeBefore){
        res.added = sizeAfter-sizeBefore;
    }
    if(sizeBefore>sizeAfter){
        res.deleted = sizeAfter-sizeBefore;
    }

    this.sources$.next(this.sources);
    
    return res;

  }

  private updateResultState(){
    this.queryResult$.next(this.queryResult);
  }

  private getActiveSources(){
    // return [this.sources[0].value, { type: 'sparql', value: 'https://dbpedia.org/sparql' }];
    // return [{ type: 'sparql', value: 'https://dbpedia.org/sparql' }];
    return this.sources.filter(item => item.active).map(item => item.value);
    // return this.sources.filter(item => item.active).map(item => item.type == SourceType.RDFJS ? item.value : item);
  }

  private idIsUnique(id: string){
    const match = this.sources.find(source => source.id == id);
    return match ? false : true;
  }

  // Get the primary data source (the one update queries are executed against)
  private getPrimarySource(){
    return this.sources.filter(item => item.primary).map(item => item.value)[0];
  }

  private async streamToString(stream: any): Promise<any> {

    let str: string = "";

    stream.setEncoding("utf8");

    return new Promise((resolve, reject) => {

      stream.on('data', (chunk: any) => {
        if(typeof chunk == "string") str+=chunk;
      });
  
      stream.on('error', (error: any) => {
        reject(error);
      });
  
      stream.on('end', () => {
        resolve(str);
      });

    });

  }

  private streamToJSONObservable(stream: any, responseType: ResponseType): Observable<any> {

    const accumulatedResults$ = new BehaviorSubject([]);
    const singleResults$ = new BehaviorSubject(null);

    let allResults: any = [];
    let counter = 0;

    stream.setEncoding("utf8");

    stream.on("data", (chunk: string) => {
      if (typeof chunk == "string" && chunk.startsWith("{") && !chunk.startsWith('{"head": {"vars"')) {
        const binding = JSON.parse(chunk);
        allResults.push(binding);
        counter++;
        singleResults$.next(binding);
        accumulatedResults$.next(allResults);

        // Update result observable
        this.queryResult.result = allResults;
        this.updateResultState();
      }
    });

    stream.on("error", (err: any) => {
      console.log("ERROR!")
      singleResults$.error(err);
      accumulatedResults$.error(err);
    });

    stream.on("end", () => {
      console.log(`Found ${counter} bindings to the query`);
      singleResults$.complete();
      accumulatedResults$.complete();

      // Update result observable
      this.queryResult.complete = true;
      this.queryResult.running = false;
      this.updateResultState();
    });

    if (responseType == ResponseType.ACCUMULATED) {
      return accumulatedResults$.asObservable();
    }

    return singleResults$.asObservable();

  }

}