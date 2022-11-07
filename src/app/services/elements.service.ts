import { Injectable } from '@angular/core';
// import { ComunicaService } from 'ngx-comunica';
import { ComunicaService } from 'src/app/3rdparty/comunica/comunica.service';
import { Serialization, Source, SourceType, UpdateResult } from 'src/app/3rdparty/comunica/models';
import { WKTObject, WKTObjectOptions } from 'ngx-ifc-viewer';
import { lastValueFrom } from 'rxjs';
import { Space } from '../models';
import { AppComponent } from '../app.component';
import { UtilsService } from './utils.service';

@Injectable({
  providedIn: 'root',
})
export class ElementsService {
  public queryResult?: any;
  public queryComplete: boolean = false;

  constructor(
    private _comunica: ComunicaService,
    private _util: UtilsService
  ) {}

  async getWallTypes(): Promise<Space[]> {
    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> 
    PREFIX ex: <https://example.com/> 
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    
    SELECT ?psetName (GROUP_CONCAT(?propName) AS ?properties)
    WHERE { 
        ?pset a ifc:IfcPropertySet ;
                rdfs:label ?psetName ;
                ex:hasProperty ?property .
        ?property rdfs:label ?propName
    } GROUP BY ?psetName
       `;
    const spaces = await lastValueFrom(this._comunica.selectQuery(query));
    return spaces.map((item: any) => {
      const Pset = item.psetName.value;
      const Props = item.properties.value;

      return { Pset, Props };
    });
  }

  async insetUValues0(excelData: any): Promise<UpdateResult> {
    console.log(" query insert")
    console.log(excelData[0].WallTypes)

    const values = this._util.buildValueStringMulti(excelData);

    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    PREFIX ex: <https://example.com/> 
    
    INSERT{ ?wall ex:uValue ?uValue } 
    WHERE {
    ?wall a ifc:IfcWallStandardCase . 
    ?wall <https://web-bim/resources/referencePsetWallcommon> ?type .
    
    VALUES ( ?type ?uValue ) 
    {( "Basic Wall:Interior - Partition (92mm Stud)"^^<xsd:string> 0.12  ) 
     ( "Basic Wall:Exterior - Brick on Block}"^^<xsd:string> 0.14  )
     ( "Basic Wall:Interior - Plumbing (152mm Stud)"^^<xsd:string> 0.15  )
     ( "Basic Wall:Party Wall - CMU Residential Unit Dimising Wall"^^<xsd:string> 0.11  )
     ( "Basic Wall:Interior - Furring (152 mm Stud)"^^<xsd:string> 0.12  )
     ( "Basic Wall:Interior - Furring (38 mm Stud)"^^<xsd:string> 0.1  )
     ( "Basic Wall:Foundation - Concrete (417mm)"^^<xsd:string> 0.16  )
     ( "Basic Wall:Foundation - Concrete (435mm)"^^<xsd:string> 0.17 ) }
    }`;

    console.log(query);
    return this._comunica.updateQuery(query);

  }

  async insetUValues(excelData: any) {
    console.log(" query insert")
    console.log(excelData[0].WallTypes)

    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    PREFIX ex: <https://example.com/> 
    
    INSERT{ ?wall ex:uValue ?uValue } 
    WHERE {
    ?wall a ifc:IfcWallStandardCase . 
    ?wall <https://web-bim/resources/referencePsetWallcommon> ?type .
    
    VALUES ( ?type ?uValue ) 
    {( "${excelData[0].WallTypes}"^^<xsd:string> ${excelData[0].UValue}  ) 
     ( "${excelData[1].WallTypes}"^^<xsd:string> ${excelData[1].UValue}  )
     ( "${excelData[2].WallTypes}"^^<xsd:string> ${excelData[2].UValue}  )
     ( "${excelData[3].WallTypes}"^^<xsd:string> ${excelData[3].UValue}  )
     ( "${excelData[4].WallTypes}"^^<xsd:string> ${excelData[4].UValue}  ) }
    } `;

    this.queryResult = undefined;
    this.queryComplete = false;

    try {
      this.queryResult = await this._comunica.updateQuery(query);
      this.queryComplete = true;
    } catch (err) {
      console.log(err);
    }
  }



  async getUValues0(): Promise<Space[]> {
    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    PREFIX ex: <https://example.com/> 
        
    SELECT ?wall ?uValue ?type
    WHERE{ ?wall ex:uValue ?uValue ; 
                 <https://web-bim/resources/referencePsetWallcommon> ?type }
   `;
    const values = await lastValueFrom(this._comunica.selectQuery(query));
    return values.map((item: any) => {
      const wall = item.wall.value;
      const uValue = item.uValue.value;
      const type = item.type.value;

      return { wall, uValue, type };
    });
  }

  async getUValues(): Promise<Space[]> {
    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> 
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#> 
    PREFIX kga: <https://w3id.org/kobl/geometry-analysis#> 
    PREFIX bot: <https://w3id.org/bot#> 
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> 
    PREFIX ex: <https://example.com/> 
        
        
    SELECT ?type ?wallArea ?uValue ((?wallArea * ?uValue * 32 ) AS ?transmissionloss)
    WHERE {
      
      {SELECT ?type ?uValue (SUM(?a) AS ?wallArea) 
      WHERE{  
          ?space a bot:Space .
          ?wall a ifc:IfcWallStandardCase .
          ?wall <https://web-bim/resources/referencePsetWallcommon> ?type .
          ?wall ex:uValue ?uValue . 
          ?i a bot:Interface ; 
        bot:interfaceOf ?space, ?wall  ; 
          kga:area ?a .  }
      GROUP BY ?type ?uValue }}
   `;
    const values = await lastValueFrom(this._comunica.selectQuery(query));
    return values.map((item: any) => {
      const type = item.type.value;
      const wallArea = item.wallArea.value;
      const uValue = item.uValue.value;
      const transmissionloss = item.transmissionloss.value;
      
      return { type, wallArea, uValue, transmissionloss };
    });
  }

}
